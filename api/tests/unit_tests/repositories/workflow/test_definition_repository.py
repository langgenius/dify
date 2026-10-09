"""Persistence boundaries use real short SQLite sessions, including rollback."""

import json
from collections.abc import Callable
from dataclasses import replace
from typing import cast
from unittest.mock import Mock, create_autospec, patch
from uuid import uuid4

import pytest
from sqlalchemy import Select, event, func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker

from core.workflow.llm_environment_variable import LLMEnvironmentVariable
from enums import DeploymentEdition
from enums.agent import WorkflowAgentBindingType
from extensions.application_services.workflow import build_workflow_definition_gateway
from extensions.application_services.workflow_variables import (
    build_console_workflow_variables,
    build_workflow_variable_service,
)
from fields.workflow_fields import WorkflowResponse
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.variables import StringSegment, StringVariable
from machinery.context import RequestContext
from models import Account, App
from models.account import TenantAccountJoin, TenantAccountRole
from models.agent import WorkflowAgentNodeBinding
from models.agent_config_entities import WorkflowNodeJobConfig
from models.dataset import AppDatasetJoin
from models.enums import CredentialSourceType
from models.model import AppMode
from models.provider import LoadBalancingModelConfig
from models.tools import BuiltinToolProvider
from models.workflow import Workflow, WorkflowDraftVariable, WorkflowVersionCounter
from repositories.app.console_repository import ConsoleAppRepository
from repositories.credentials.query_repository import CredentialQueryRepository
from repositories.workflow.definition_repository import (
    WorkflowDefinitionRepository,
    WorkflowDefinitionStore,
    workflow_snapshot,
)
from repositories.workflow.draft_repository import WorkflowDraftRepository
from services import workflow_service as workflow_module
from services.agent.workflow_contracts import AgentSkillReader, WorkflowAgentBindingStore
from services.agent.workflow_publish_service import WorkflowAgentPublishService
from services.app.console_service import ConsoleAppNotFoundError
from services.data_migration.entities import ImportTarget
from services.data_migration.import_service import MigrationImportService
from services.errors.app import TriggerNodeLimitExceededError, WorkflowHashNotEqualError
from services.errors.workflow_service import DraftWorkflowDeletionError, WorkflowInUseError
from services.tools.workflow_tools_manage_service import WorkflowToolManageService
from services.workflow import definition_gateway as gateway_module
from services.workflow.console_service import (
    ConsoleWorkflowService,
    WorkflowAccess,
    WorkflowAppLookup,
    WorkflowConversion,
    WorkflowPresence,
    WorkflowRuntime,
)
from services.workflow.contracts import (
    DraftSyncCommand,
    PreparedDraftSync,
    ValidatedWorkflowPublication,
    WorkflowOwner,
    WorkflowPublication,
    WorkflowSnapshot,
)
from services.workflow.definition_gateway import WorkflowDefinitionGateway
from services.workflow.draft_service import DraftAgentRetirement, WorkflowDraftService
from services.workflow.environment_variable_service import prepare_environment_variables
from services.workflow_service import WorkflowService
from tests.unit_tests.model_factories import make_account, make_app, make_tenant, make_workflow

CONTEXT = RequestContext("request", None, "account-1", "tenant-1")


@pytest.mark.parametrize("kind", ["tool", "agent", "llm"])
@pytest.mark.parametrize("denied", [False, True])
def test_publication_credential_policy_runs_after_read_transactions_close(
    seeded: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, kind: str, denied: bool
) -> None:
    provider = "langgenius/openai/openai"
    tool = BuiltinToolProvider(
        tenant_id="tenant-1", user_id="account-1", provider=provider, name="default", is_default=True
    )
    data: dict[str, object] = {"type": kind, "provider_id": provider}
    if kind == "agent":
        data["agent_parameters"] = {"tools": {"value": [{"provider_name": provider}]}}
    if kind == "llm":
        data["model"] = {"provider": provider, "name": "model"}
    with seeded.begin() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        draft.graph = json.dumps({"nodes": [{"id": "node", "data": data}], "edges": []})
        session.add(tool)
        for tenant, credential, source in [
            ("tenant-1", "provider-credential", CredentialSourceType.PROVIDER),
            ("tenant-1", "model-credential", CredentialSourceType.CUSTOM_MODEL),
            ("foreign-tenant", "foreign-credential", CredentialSourceType.PROVIDER),
        ]:
            session.add(
                LoadBalancingModelConfig(
                    tenant_id=tenant,
                    provider_name=provider,
                    model_name="model",
                    model_type=ModelType.LLM,
                    name=credential,
                    credential_id=credential,
                    credential_source_type=source,
                )
            )
    sessions: list[Session] = []

    def opened(session: Session, _transaction: object, _connection: object) -> None:
        sessions.append(session)

    checked: list[str] = []

    def check(credential_id: str, *_args: object, **_kwargs: object) -> None:
        assert sessions
        assert all(not session.in_transaction() for session in sessions)
        checked.append(credential_id)
        if denied:
            raise ValueError("credential policy denied")

    workflows = WorkflowService(session_maker=seeded)
    monkeypatch.setattr(workflow_module.SystemFeatureService, "is_plugin_manager_enabled", lambda: True)
    monkeypatch.setattr(workflows, "validate_graph_structure", lambda **_kwargs: None)
    monkeypatch.setattr(workflows, "_validate_llm_model_config", lambda *_args: None)
    monkeypatch.setattr(workflows, "_is_load_balancing_enabled", lambda *_args: True)
    monkeypatch.setattr("core.helper.credential_utils.check_credential_policy_compliance", check)
    lifecycle = WorkflowDefinitionGateway(
        session_factory=seeded,
        drafts=WorkflowDraftRepository(seeded),
        definitions=WorkflowDefinitionRepository(session_factory=seeded),
        workflows=workflows,
        credentials=CredentialQueryRepository(session_factory=seeded),
        skills=create_autospec(AgentSkillReader, instance=True),
    )
    event.listen(seeded, "after_begin", opened)
    try:
        if denied:
            with pytest.raises(ValueError, match="credential policy denied"):
                lifecycle.validate_publish(CONTEXT, "app-1")
        else:
            assert lifecycle.validate_publish(CONTEXT, "app-1").workflow.id == "draft"
            expected = {"provider-credential", "model-credential"} if kind == "llm" else {tool.id}
            assert set(checked) == expected
        assert checked
        assert all(not session.in_transaction() for session in sessions)
    finally:
        event.remove(seeded, "after_begin", opened)


@pytest.fixture
def seeded(sqlite_session_factory: sessionmaker[Session]) -> sessionmaker[Session]:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                make_account(),
                make_tenant(),
                TenantAccountJoin(tenant_id="tenant-1", account_id="account-1", role=TenantAccountRole.OWNER),
                make_app(workflow_id="published", mode=AppMode.WORKFLOW, created_by="account-1"),
                make_workflow(workflow_id="draft"),
                make_workflow(workflow_id="published", version="1", version_number=1),
                WorkflowVersionCounter(app_id="app-1", last_version_number=1),
            ]
        )
    return sqlite_session_factory


@pytest.fixture
def repository(seeded: sessionmaker[Session]) -> WorkflowDefinitionRepository:
    return WorkflowDefinitionRepository(session_factory=seeded)


def test_published_result_is_complete_after_session_closes(repository: WorkflowDefinitionRepository) -> None:
    record = repository.published(CONTEXT, "app-1")
    assert record is not None
    response = WorkflowResponse.model_validate(record, from_attributes=True).model_dump(mode="json")
    assert response["id"] == "published"
    assert response["version_number"] == 1
    assert response["created_by"]["id"] == "account-1"
    assert response["tool_published"] is False


def test_update_version_remarks_masks_secrets_without_key_io(
    seeded: sessionmaker[Session], repository: WorkflowDefinitionRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.helper.encrypter import full_mask_token

    environment = json.dumps(
        {
            "API_KEY": {"id": "secret-id", "name": "API_KEY", "value_type": "secret", "value": "ciphertext"},
            "COUNT": {"id": "number-id", "name": "COUNT", "value_type": "number", "value": 3},
        }
    )
    with seeded.begin() as session:
        workflow = session.get(Workflow, "published")
        assert workflow is not None
        workflow._environment_variables = environment
    sessions: list[Session] = []

    def opened(session: Session, *_args: object) -> None:
        sessions.append(session)

    def key_io(**_kwargs: object) -> str:
        assert all(not session.in_transaction() for session in sessions)
        pytest.fail("A display-only projection must not wrap or unwrap secret values")

    monkeypatch.setattr("core.helper.encrypter.decrypt_token", key_io)
    monkeypatch.setattr("core.helper.encrypter.encrypt_token", key_io)
    event.listen(seeded, "after_begin", opened)
    try:
        record = repository.update(CONTEXT, "app-1", "published", {"marked_comment": "New remarks"})
        assert record is not None
        assert sessions
        assert all(not session.in_transaction() for session in sessions)
        assert {variable.name: variable.value for variable in record.environment_variables} == {
            "API_KEY": full_mask_token(),
            "COUNT": 3,
        }
        response = WorkflowResponse.model_validate(record, from_attributes=True)
        assert response.marked_comment == "New remarks"
        assert response.environment_variables[0].value == full_mask_token()
    finally:
        event.remove(seeded, "after_begin", opened)
    with seeded() as session:
        workflow = session.get(Workflow, "published")
        assert workflow is not None
        assert workflow.marked_comment == "New remarks"
        assert workflow.updated_by == CONTEXT.account_id
        assert workflow._environment_variables == environment


def test_version_counter_allocation_is_rolled_back_with_publication(seeded: sessionmaker[Session]) -> None:
    from repositories.workflow.version_repository import allocate_version_number

    with seeded.begin() as session:
        assert allocate_version_number(session=session, app_id="app-1") == 2
    with seeded() as session, session.begin():
        assert allocate_version_number(session=session, app_id="app-1") == 3
        session.rollback()
    with seeded.begin() as session:
        assert allocate_version_number(session=session, app_id="app-1") == 3


@pytest.mark.parametrize("concurrent_edit", [False, True])
def test_publication_copies_secret_ciphertext_without_key_io_under_locks(
    seeded: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, concurrent_edit: bool
) -> None:
    ciphertext = json.dumps(
        {
            "secret-id": {
                "id": "secret-id",
                "name": "API_KEY",
                "value_type": "secret",
                "value": "wrapped-secret",
            }
        }
    )
    with seeded.begin() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        draft._environment_variables = ciphertext
    sessions: list[Session] = []
    unwrapped: list[str] = []

    def opened(session: Session, _transaction: object, _connection: object) -> None:
        sessions.append(session)

    def unwrap(*, tenant_id: str, token: str) -> str:
        assert tenant_id == "tenant-1"
        assert all(not session.in_transaction() for session in sessions)
        unwrapped.append(token)
        if concurrent_edit:
            with seeded.begin() as session:
                draft = session.get(Workflow, "draft")
                assert draft is not None
                draft._environment_variables = ciphertext.replace("wrapped-secret", "changed-secret")
        return "plaintext"

    def wrap(**_kwargs: object) -> str:
        pytest.fail("Publishing within the same tenant must preserve the encrypted value")

    monkeypatch.setattr("core.helper.encrypter.decrypt_token", unwrap)
    monkeypatch.setattr("core.helper.encrypter.encrypt_token", wrap)
    console_variables = build_console_workflow_variables(
        database_client=seeded, variables=build_workflow_variable_service(database_client=seeded)
    )
    with seeded.begin() as session:
        app = session.get(App, "app-1")
        assert app is not None
        app.mode = AppMode.ADVANCED_CHAT
    workflows = WorkflowService(seeded)
    monkeypatch.setattr(workflows, "validate_graph_structure", lambda **_kwargs: None)
    definitions = WorkflowDefinitionRepository(session_factory=seeded)
    service = application(
        build_workflow_definition_gateway(seeded, definitions, workflows, drafts=WorkflowDraftRepository(seeded))
    )
    event.listen(seeded, "after_begin", opened)
    try:
        if concurrent_edit:
            with pytest.raises(WorkflowHashNotEqualError):
                service.publish(CONTEXT, "app-1", marked_name="Secrets", marked_comment="")
        else:
            service.publish(CONTEXT, "app-1", marked_name="Secrets", marked_comment="")
    finally:
        event.remove(seeded, "after_begin", opened)
    assert unwrapped == ["wrapped-secret"]
    with seeded() as session:
        app = session.get(App, "app-1")
        assert app is not None
        if concurrent_edit:
            assert app.workflow_id == "published"
        else:
            assert app.workflow_id != "published"
            published = session.get(Workflow, app.workflow_id)
            assert published is not None
            assert published._environment_variables == ciphertext


@pytest.mark.parametrize("entry", ["sync", "collaborative", "replace", "patch"])
@pytest.mark.parametrize("concurrent_edit", [False, True])
def test_draft_secret_preparation_releases_sessions_and_rechecks_snapshot(
    seeded: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, entry: str, concurrent_edit: bool
) -> None:
    from constants import HIDDEN_VALUE
    from graphon.variables import SecretVariable

    original = json.dumps(
        {"API_KEY": {"id": "secret-id", "name": "API_KEY", "value_type": "secret", "value": "wrapped"}}
    )
    with seeded.begin() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        draft._environment_variables = original
        source = workflow_snapshot(draft)

    sessions: list[Session] = []
    operations: list[str] = []

    def opened(session: Session, _transaction: object, _connection: object) -> None:
        sessions.append(session)

    def decrypt(*, tenant_id: str, token: str) -> str:
        assert tenant_id == "tenant-1"
        assert token == "wrapped"
        assert all(not session.in_transaction() for session in sessions)
        operations.append("decrypt")
        return "old-secret"

    def encrypt(*, tenant_id: str, token: str) -> str:
        assert tenant_id == "tenant-1"
        assert all(not session.in_transaction() for session in sessions)
        operations.append("encrypt")
        if concurrent_edit and operations.count("encrypt") == 1:
            with seeded.begin() as session:
                draft = session.get(Workflow, "draft")
                assert draft is not None
                draft.graph = '{"nodes": [], "edges": [], "concurrent": true}'
        return "encrypted:" + token

    monkeypatch.setattr("core.helper.encrypter.decrypt_token", decrypt)
    monkeypatch.setattr("core.helper.encrypter.encrypt_token", encrypt)
    console_variables = build_console_workflow_variables(
        database_client=seeded, variables=build_workflow_variable_service(database_client=seeded)
    )
    with seeded.begin() as session:
        app = session.get(App, "app-1")
        assert app is not None
        app.mode = AppMode.ADVANCED_CHAT
    workflows = WorkflowService(seeded)
    monkeypatch.setattr(workflows, "validate_graph_structure", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(workflows, "validate_features_structure", lambda *_args: None)
    definitions = WorkflowDefinitionRepository(session_factory=seeded)
    service = application(
        build_workflow_definition_gateway(seeded, definitions, workflows, drafts=WorkflowDraftRepository(seeded))
    )
    variables = [
        SecretVariable(id="secret-id", name="RENAMED_KEY", value=HIDDEN_VALUE),
        SecretVariable(id="new-secret", name="NEW_KEY", value="new-secret"),
    ]

    def save() -> None:
        if entry in ("replace", "patch"):
            console_variables.update_environment(
                CONTEXT,
                "app-1",
                [variable.model_dump(mode="json") for variable in variables],
                deleted_ids=[] if entry == "patch" else None,
            )
        else:
            mappings = [variable.model_dump(mode="json") for variable in variables]
            service.sync(
                CONTEXT,
                "app-1",
                DraftSyncCommand(
                    graph={"nodes": [], "edges": [], "saved": True},
                    features={},
                    unique_hash=source.hash,
                    is_collaborative=entry == "collaborative",
                    conversation_variables=[],
                    environment_variables=mappings if entry == "sync" else None,
                    environment_upserts=mappings if entry == "collaborative" else None,
                    environment_deletions=[],
                ),
            )

    event.listen(seeded, "after_begin", opened)
    try:
        if concurrent_edit and entry in ("sync", "collaborative"):
            with pytest.raises(WorkflowHashNotEqualError):
                save()
        else:
            save()
    finally:
        event.remove(seeded, "after_begin", opened)
    assert "decrypt" in operations
    assert "encrypt" in operations
    with seeded() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        if concurrent_edit and entry in ("sync", "collaborative"):
            assert draft._environment_variables == original
        else:
            values = json.loads(draft._environment_variables)
            assert values["RENAMED_KEY"]["value"] == "encrypted:old-secret"
            assert values["NEW_KEY"]["value"] == "encrypted:new-secret"
        if concurrent_edit:
            assert draft.graph_dict["concurrent"] is True


@pytest.mark.parametrize("rollback", [False, True])
def test_dsl_secret_preparation_precedes_the_atomic_import_transaction(
    seeded: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, rollback: bool
) -> None:
    import yaml

    from constants.dsl_version import CURRENT_APP_DSL_VERSION
    from extensions.application_services.workflow import build_app_dsl_service
    from services.entities.dsl_entities import ImportStatus

    sessions: list[Session] = []
    encrypted: list[str] = []

    def opened(session: Session, _transaction: object, _connection: object) -> None:
        sessions.append(session)

    def encrypt(*, tenant_id: str, token: str) -> str:
        assert tenant_id == "tenant-1"
        assert all(not session.in_transaction() for session in sessions)
        encrypted.append(token)
        return "encrypted:" + token

    monkeypatch.setattr("core.helper.encrypter.encrypt_token", encrypt)
    monkeypatch.setattr(WorkflowService, "validate_graph_structure", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(WorkflowService, "validate_features_structure", lambda *_args, **_kwargs: None)
    event.listen(Session, "after_begin", opened)
    try:
        with seeded() as session:
            result = build_app_dsl_service(session).import_app(
                account=make_account(tenant=make_tenant()),
                import_mode="yaml-content",
                app_id="app-1",
                yaml_content=yaml.safe_dump(
                    {
                        "version": CURRENT_APP_DSL_VERSION,
                        "kind": "app",
                        "app": {"mode": "workflow", "name": "Imported"},
                        "workflow": {
                            "graph": {"nodes": [], "edges": []},
                            "features": {},
                            "environment_variables": [
                                {"id": "secret-id", "name": "KEY", "value_type": "secret", "value": "secret"}
                            ],
                        },
                    }
                ),
            )
            assert result.status == ImportStatus.COMPLETED, result.error
            if rollback:
                session.rollback()
            else:
                session.commit()
    finally:
        event.remove(Session, "after_begin", opened)
    assert encrypted == ["secret"]
    with seeded() as session:
        draft = session.get(Workflow, "draft")
        app = session.get(App, "app-1")
        assert draft is not None
        assert app is not None
        if rollback:
            assert json.loads(draft._environment_variables) == {}
            assert app.name != "Imported"
        else:
            assert json.loads(draft._environment_variables)["KEY"]["value"] == "encrypted:secret"
            assert app.name == "Imported"


@pytest.mark.parametrize("rollback", [False, True])
def test_workflow_and_bindings_delete_atomically_before_agent_retirement(
    seeded: sessionmaker[Session], rollback: bool
) -> None:
    with seeded.begin() as session:
        session.add(make_workflow(workflow_id="obsolete", version="old-version"))
        session.add_all(
            WorkflowAgentNodeBinding(
                id=f"binding-{node}",
                tenant_id="tenant-1",
                app_id="app-1",
                workflow_id="obsolete",
                workflow_version="old-version",
                node_id=node,
                binding_type=kind,
                agent_id=agent,
                node_job_config={},
            )
            for node, kind, agent in [
                ("one", WorkflowAgentBindingType.INLINE_AGENT, "inline-agent"),
                ("two", WorkflowAgentBindingType.INLINE_AGENT, "inline-agent"),
                ("roster", WorkflowAgentBindingType.ROSTER_AGENT, "roster-agent"),
            ]
        )
    definitions = WorkflowDefinitionRepository(session_factory=seeded)
    service = application(
        build_workflow_definition_gateway(
            seeded, definitions, WorkflowService(seeded), drafts=WorkflowDraftRepository(seeded)
        )
    )
    retired: list[list[str]] = []

    def retire(context: RequestContext, agent_ids: list[str]) -> None:
        assert context is CONTEXT
        with seeded() as session:
            assert session.get(Workflow, "obsolete") is None
            assert session.scalar(select(func.count()).select_from(WorkflowAgentNodeBinding)) == 0
        retired.append(agent_ids)

    cast(Mock, service._runtime).retire_agents.side_effect = retire

    def fail_commit(_session: Session) -> None:
        if rollback:
            raise RuntimeError("delete commit failed")

    event.listen(seeded, "before_commit", fail_commit)
    try:
        if rollback:
            with pytest.raises(RuntimeError, match="delete commit failed"):
                service.delete(CONTEXT, WorkflowOwner("app-1"), "obsolete")
        else:
            service.delete(CONTEXT, WorkflowOwner("app-1"), "obsolete")
    finally:
        event.remove(seeded, "before_commit", fail_commit)
    with seeded() as session:
        assert (session.get(Workflow, "obsolete") is not None) is rollback
        assert session.scalar(select(func.count()).select_from(WorkflowAgentNodeBinding)) == (3 if rollback else 0)
    assert retired == ([] if rollback else [["inline-agent"]])


@pytest.mark.parametrize("rollback", [False, True])
def test_dsl_replacement_and_variable_invalidation_are_atomic(seeded: sessionmaker[Session], rollback: bool) -> None:
    variables = [
        WorkflowDraftVariable.new_node_variable(
            app_id=app_id,
            user_id=user_id,
            node_id="node",
            name="value",
            value=StringSegment(value="old"),
            node_execution_id="execution",
        )
        for app_id, user_id in [("app-1", "user-1"), ("app-1", "user-2"), ("other-app", "user-1")]
    ]
    with seeded.begin() as session:
        session.add_all(variables)

    def import_draft() -> None:
        with seeded.begin() as session:
            app = session.get(App, "app-1")
            draft = session.get(Workflow, "draft")
            account = session.get(Account, "account-1")
            assert app is not None
            assert draft is not None
            assert account is not None
            WorkflowDefinitionStore.sync_draft_workflow(
                app_model=app,
                session=session,
                graph={"nodes": [], "edges": [], "imported": True},
                features={},
                prepared=PreparedDraftSync(workflow_snapshot(draft), None),
                account_id=account.id,
                conversation_variables=[],
                clear_debug_variables=True,
            )
            if rollback:
                raise RuntimeError("import failed")

    if rollback:
        with pytest.raises(RuntimeError, match="import failed"):
            import_draft()
    else:
        import_draft()
    with seeded() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        assert draft.graph_dict.get("imported", False) is not rollback
        remaining = set(session.scalars(select(WorkflowDraftVariable.id)))
        assert remaining == ({variable.id for variable in variables} if rollback else {variables[-1].id})


def test_draft_projection_does_not_mutate_persisted_graph(
    seeded: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        WorkflowAgentPublishService,
        "project_draft_bindings_to_graph",
        lambda _self, **_kwargs: {"nodes": [{"id": "projected"}]},
    )
    repository = WorkflowDefinitionRepository(session_factory=seeded)
    with repository.draft(CONTEXT, "app-1") as draft:
        assert draft is not None
        projected = WorkflowAgentPublishService(repository=draft.bindings).project_draft_bindings_to_graph(
            draft_workflow=draft.workflow
        )
    assert projected == {"nodes": [{"id": "projected"}]}
    with seeded() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        assert draft.graph_dict == {"nodes": [], "edges": []}


def test_queries_and_updates_keep_complete_owner_chain(
    repository: WorkflowDefinitionRepository, seeded: sessionmaker[Session]
) -> None:
    with pytest.raises(ConsoleAppNotFoundError):
        repository.published(CONTEXT._replace(active_workspace_id="tenant-2"), "app-1")
    with seeded.begin() as session:
        session.add(make_workflow(workflow_id="foreign", tenant_id="tenant-2", app_id="other-app", version="1"))
    assert repository.update(CONTEXT, "app-1", "foreign", {"marked_name": "modified"}) is None
    with seeded() as session:
        foreign = session.get(Workflow, "foreign")
        assert foreign is not None
        assert foreign.marked_name == ""


def application(lifecycle: WorkflowDefinitionGateway) -> ConsoleWorkflowService[WorkflowAgentBindingStore]:
    return ConsoleWorkflowService(
        conversion=create_autospec(WorkflowConversion, instance=True),
        agent_services=WorkflowAgentPublishService,
        definitions=cast(WorkflowDefinitionRepository, lifecycle._definitions),
        drafts=WorkflowDraftService(
            agent_services=WorkflowAgentPublishService,
            definitions=cast(WorkflowDraftRepository, lifecycle._drafts),
            lifecycle=lifecycle,
            retirement=create_autospec(DraftAgentRetirement, instance=True),
        ),
        lifecycle=lifecycle,
        runtime=create_autospec(WorkflowRuntime, instance=True),
        apps=create_autospec(WorkflowAppLookup, instance=True),
        presence=create_autospec(WorkflowPresence, instance=True),
        access=create_autospec(WorkflowAccess, instance=True),
    )


def publish(lifecycle: WorkflowDefinitionGateway, snapshot: WorkflowSnapshot) -> WorkflowPublication:
    # Supply the previously validated snapshot to exercise a concurrent edit or
    # failed commit through the same orchestration as the console and migration.
    with patch.object(lifecycle, "validate_publish", return_value=ValidatedWorkflowPublication(snapshot, ())):
        result, _ = application(lifecycle).publish(CONTEXT, "app-1", marked_name="Release", marked_comment="")
    return result


@pytest.mark.parametrize("fail_commit", [False, True])
def test_publication_and_app_pointer_commit_atomically(seeded: sessionmaker[Session], fail_commit: bool) -> None:
    lifecycle = WorkflowDefinitionGateway(
        session_factory=seeded,
        drafts=WorkflowDraftRepository(seeded),
        definitions=WorkflowDefinitionRepository(session_factory=seeded),
        workflows=WorkflowService(session_maker=seeded),
        credentials=CredentialQueryRepository(session_factory=seeded),
        skills=create_autospec(AgentSkillReader, instance=True),
    )
    with seeded() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        snapshot = workflow_snapshot(draft)

    def fail(_session: object) -> None:
        raise RuntimeError("commit failed")

    if fail_commit:
        event.listen(seeded, "before_commit", fail)
    try:
        if fail_commit:
            with pytest.raises(RuntimeError, match="commit failed"):
                publish(lifecycle, snapshot)
        else:
            assert publish(lifecycle, snapshot).graph
    finally:
        if fail_commit:
            event.remove(seeded, "before_commit", fail)
    with seeded() as session:
        app = session.get(App, "app-1")
        version = session.scalar(select(Workflow).where(Workflow.marked_name == "Release"))
        assert app is not None
        assert (version is None) is fail_commit
        if fail_commit:
            assert app.workflow_id == "published"
        else:
            assert version is not None
            assert app.workflow_id == version.id


@pytest.mark.parametrize(
    ("workflow_id", "error"), [("draft", DraftWorkflowDeletionError), ("published", WorkflowInUseError)]
)
def test_delete_preserves_domain_rejections(
    repository: WorkflowDefinitionRepository, workflow_id: str, error: type[Exception]
) -> None:
    with pytest.raises(error):
        repository.delete(CONTEXT, WorkflowOwner("app-1"), workflow_id)


def test_sync_prepares_patch_without_replacing_server_environment(seeded: sessionmaker[Session]) -> None:
    with seeded.begin() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        draft.features = '{"collaborator": true}'
        draft.environment_variables = [StringVariable(id="untouched", name="OTHER", value="server")]
        draft_hash = draft.unique_hash
    command = DraftSyncCommand(
        graph={"nodes": [], "edges": []},
        features={},
        unique_hash=draft_hash,
        is_collaborative=True,
        environment_upserts=[{"id": "id", "name": "KEY", "value_type": "string", "value": "value"}],
        environment_deletions=[],
        conversation_variables=[],
    )
    application(
        WorkflowDefinitionGateway(
            session_factory=seeded,
            drafts=WorkflowDraftRepository(seeded),
            definitions=WorkflowDefinitionRepository(session_factory=seeded),
            workflows=WorkflowService(session_maker=seeded),
            credentials=CredentialQueryRepository(session_factory=seeded),
            skills=create_autospec(AgentSkillReader, instance=True),
        )
    ).sync(CONTEXT, "app-1", command)
    with seeded() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        assert draft.features_dict["collaborator"] is True
        assert {value.name: value.value for value in draft.environment_variables} == {"OTHER": "server", "KEY": "value"}
    application(
        WorkflowDefinitionGateway(
            session_factory=seeded,
            drafts=WorkflowDraftRepository(seeded),
            definitions=WorkflowDefinitionRepository(session_factory=seeded),
            workflows=WorkflowService(session_maker=seeded),
            credentials=CredentialQueryRepository(session_factory=seeded),
            skills=create_autospec(AgentSkillReader, instance=True),
        )
    ).sync(CONTEXT, "app-1", replace(command, environment_upserts=None))
    with seeded() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        assert {value.name: value.value for value in draft.environment_variables} == {"OTHER": "server", "KEY": "value"}


def test_app_maintainers_reuses_tenant_scoped_app_repository(seeded: sessionmaker[Session]) -> None:
    with seeded.begin() as session:
        session.add_all(
            [
                make_app(app_id="other", tenant_id="tenant-2"),
                make_app(app_id="local", maintainer="owner"),
            ]
        )
    repository = ConsoleAppRepository(session_factory=seeded)
    assert repository.maintainers(CONTEXT, ["app-1", "other", "local", "missing"]) == {"app-1": None, "local": "owner"}


@pytest.mark.parametrize("operation", ["sync", "restore", "publish", "features"])
@pytest.mark.parametrize("fail_commit", [False, True])
def test_use_case_notifies_only_after_real_transaction_commits(
    seeded: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, operation: str, fail_commit: bool
) -> None:
    repository = WorkflowDefinitionRepository(session_factory=seeded)
    lifecycle = WorkflowDefinitionGateway(
        session_factory=seeded,
        drafts=WorkflowDraftRepository(seeded),
        definitions=WorkflowDefinitionRepository(session_factory=seeded),
        workflows=WorkflowService(session_maker=seeded),
        credentials=CredentialQueryRepository(session_factory=seeded),
        skills=create_autospec(AgentSkillReader, instance=True),
    )
    runtime = create_autospec(WorkflowRuntime, instance=True)
    service = ConsoleWorkflowService(
        conversion=create_autospec(WorkflowConversion, instance=True),
        agent_services=WorkflowAgentPublishService,
        definitions=repository,
        drafts=WorkflowDraftService(
            agent_services=WorkflowAgentPublishService,
            definitions=WorkflowDraftRepository(seeded),
            lifecycle=lifecycle,
            retirement=create_autospec(DraftAgentRetirement, instance=True),
        ),
        lifecycle=lifecycle,
        runtime=runtime,
        apps=create_autospec(WorkflowAppLookup, instance=True),
        presence=create_autospec(WorkflowPresence, instance=True),
        access=create_autospec(WorkflowAccess, instance=True),
    )
    if operation in {"sync", "restore"}:
        with seeded.begin() as session:
            session.add(
                WorkflowAgentNodeBinding(
                    id="removed-binding",
                    tenant_id="tenant-1",
                    app_id="app-1",
                    workflow_id="draft",
                    workflow_version="draft",
                    node_id="removed-node",
                    binding_type=WorkflowAgentBindingType.INLINE_AGENT,
                    agent_id="retired-agent",
                    node_job_config=WorkflowNodeJobConfig(),
                )
            )
    with seeded() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        before = workflow_snapshot(draft)
    steps: list[str] = []
    sessions: list[Session] = []

    def opened(session: Session, _transaction: object, _connection: object) -> None:
        sessions.append(session)

    def committed(_session: Session) -> None:
        steps.append("commit")

    def fail(_session: Session) -> None:
        raise RuntimeError("commit failed")

    def retire(context: RequestContext, agent_ids: list[str]) -> None:
        assert steps == ["commit"]
        assert all(not session.in_transaction() for session in sessions)
        assert context == CONTEXT
        assert agent_ids == ["retired-agent"]
        with seeded() as session:
            assert session.get(WorkflowAgentNodeBinding, "removed-binding") is None
        steps.append("retire")

    cast(Mock, service._drafts._retirement).retire_unowned.side_effect = lambda **kwargs: retire(
        CONTEXT, kwargs["agent_ids"]
    )

    def notify(_app: App, **kwargs: object) -> None:
        assert "commit" in steps
        assert all(not session.in_transaction() for session in sessions)
        notified = kwargs["synced_draft_workflow"]
        assert isinstance(notified, Workflow)
        with seeded() as session:
            persisted = session.get(Workflow, notified.id)
            assert persisted is not None
            assert persisted.graph == notified.graph
        steps.append("notify")

    runtime.retire_agents.side_effect = retire
    monkeypatch.setattr(gateway_module.app_draft_workflow_was_synced, "send", notify)
    event.listen(seeded, "after_begin", opened)
    event.listen(seeded, "after_commit", committed)
    if fail_commit:
        event.listen(seeded, "before_commit", fail)

    def execute() -> None:
        match operation:
            case "sync":
                service.sync(
                    CONTEXT,
                    "app-1",
                    DraftSyncCommand(
                        graph={"nodes": [], "edges": [], "changed": True},
                        features={},
                        unique_hash=before.hash,
                        is_collaborative=False,
                        environment_upserts=None,
                        environment_deletions=[],
                        conversation_variables=[],
                    ),
                )
            case "restore":
                service.restore(CONTEXT, "app-1", "published")
            case "publish":
                service.publish(CONTEXT, "app-1", marked_name="Release", marked_comment="")
            case "features":
                service.update_features(CONTEXT, "app-1", {"file_upload": {"enabled": False}})

    try:
        if fail_commit:
            with pytest.raises(RuntimeError, match="commit failed"):
                execute()
            assert steps == []
            with seeded() as session:
                draft = session.get(Workflow, "draft")
                assert draft is not None
                assert workflow_snapshot(draft) == before
                if operation in {"sync", "restore"}:
                    assert session.get(WorkflowAgentNodeBinding, "removed-binding") is not None
        else:
            execute()
            assert steps == (["commit", "retire", "notify"] if operation in {"sync", "restore"} else ["commit"])
    finally:
        event.remove(seeded, "after_begin", opened)
        event.remove(seeded, "after_commit", committed)
        if fail_commit:
            event.remove(seeded, "before_commit", fail)


@pytest.mark.parametrize("field", ["graph", "features", "environment_variables"])
def test_publish_rejects_revision_modified_after_validation(seeded: sessionmaker[Session], field: str) -> None:
    with seeded() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        validated = workflow_snapshot(draft)
    with seeded.begin() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        if field == "environment_variables":
            draft.environment_variables = [StringVariable(id="changed", name="KEY", value="changed")]
        else:
            setattr(draft, field, '{"changed": true}')
    lifecycle = WorkflowDefinitionGateway(
        session_factory=seeded,
        drafts=WorkflowDraftRepository(seeded),
        definitions=WorkflowDefinitionRepository(session_factory=seeded),
        workflows=WorkflowService(session_maker=seeded),
        credentials=CredentialQueryRepository(session_factory=seeded),
        skills=create_autospec(AgentSkillReader, instance=True),
    )
    with pytest.raises(WorkflowHashNotEqualError):
        publish(lifecycle, validated)
    with seeded() as session:
        app = session.get(App, "app-1")
        assert app is not None
        assert app.workflow_id == "published"


@pytest.mark.parametrize("node_type", ["trigger-webhook", "trigger-plugin"])
def test_trigger_limit_rejects_publish_before_version_or_pointer_changes(
    seeded: sessionmaker[Session], node_type: str
) -> None:
    with seeded.begin() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        draft.graph = json.dumps(
            {
                "nodes": [
                    {
                        "id": f"trigger-{index}",
                        "data": {"type": node_type, "title": "Trigger", "subscription_id": "sub"},
                    }
                    for index in range(6)
                ],
                "edges": [],
            }
        )
    lifecycle = WorkflowDefinitionGateway(
        session_factory=seeded,
        drafts=WorkflowDraftRepository(seeded),
        definitions=WorkflowDefinitionRepository(session_factory=seeded),
        workflows=WorkflowService(session_maker=seeded),
        credentials=CredentialQueryRepository(session_factory=seeded),
        skills=create_autospec(AgentSkillReader, instance=True),
    )
    with pytest.raises(ValueError, match="maximum.*limit"):
        application(lifecycle).publish(CONTEXT, "app-1", marked_name="Rejected", marked_comment="")
    with seeded() as session:
        app = session.get(App, "app-1")
        counter = session.get(WorkflowVersionCounter, "app-1")
        assert app is not None
        assert app.workflow_id == "published"
        assert counter is not None
        assert counter.last_version_number == 1
        assert session.scalar(select(func.count()).select_from(Workflow)) == 2


def test_publication_versions_increase_without_reusing_deleted_version(seeded: sessionmaker[Session]) -> None:
    lifecycle = WorkflowDefinitionGateway(
        session_factory=seeded,
        drafts=WorkflowDraftRepository(seeded),
        definitions=WorkflowDefinitionRepository(session_factory=seeded),
        workflows=WorkflowService(session_maker=seeded),
        credentials=CredentialQueryRepository(session_factory=seeded),
        skills=create_autospec(AgentSkillReader, instance=True),
    )
    service = application(lifecycle)
    for expected in [2, 3, 4]:
        service.publish(CONTEXT, "app-1", marked_name="Release", marked_comment="")
        with seeded() as session:
            app = session.get(App, "app-1")
            assert app is not None
            workflow = session.get(Workflow, app.workflow_id)
            assert workflow is not None
            assert workflow.version_number == expected
        if expected == 3:
            with seeded.begin() as session:
                app = session.get(App, "app-1")
                assert app is not None
                app.workflow_id = "published"
            service.delete(CONTEXT, WorkflowOwner("app-1"), workflow.id)


@pytest.mark.parametrize(
    "invalid_configuration", ["missing-draft", "missing-model", "model-mode", "schedule", "cloud-limit"]
)
def test_publication_retains_blocking_domain_validations(
    seeded: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    invalid_configuration: str,
) -> None:
    expected_error: type[Exception] = ValueError
    with seeded.begin() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        if invalid_configuration == "missing-draft":
            session.delete(draft)
        elif invalid_configuration in {"missing-model", "model-mode"}:
            draft.graph = json.dumps(
                {
                    "nodes": [
                        {
                            "id": "llm",
                            "data": {
                                "type": "llm",
                                "model_selector": ["env", "shared_model"],
                                "model": {
                                    "provider": "provider",
                                    "name": "model",
                                    "mode": "chat",
                                    "completion_params": {},
                                },
                            },
                        }
                    ],
                    "edges": [],
                }
            )
            if invalid_configuration == "model-mode":
                draft.environment_variables = [
                    LLMEnvironmentVariable(
                        name="shared_model", value={"provider": "provider", "name": "model", "mode": "completion"}
                    )
                ]
        elif invalid_configuration == "schedule":
            draft.graph = json.dumps(
                {
                    "nodes": [
                        {
                            "id": "schedule",
                            "data": {
                                "title": "Schedule",
                                "type": "trigger-schedule",
                                "mode": "cron",
                                "cron_expression": "invalid",
                                "timezone": "UTC",
                            },
                        }
                    ],
                    "edges": [],
                }
            )
        else:
            config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
            monkeypatch.setattr(
                workflow_module.BillingService, "get_info", lambda *_args: {"subscription": {"plan": "sandbox"}}
            )
            draft.graph = json.dumps(
                {"nodes": [{"id": str(index), "data": {"type": "trigger-webhook"}} for index in range(3)], "edges": []}
            )
            expected_error = TriggerNodeLimitExceededError
    lifecycle = WorkflowDefinitionGateway(
        session_factory=seeded,
        drafts=WorkflowDraftRepository(seeded),
        definitions=WorkflowDefinitionRepository(session_factory=seeded),
        workflows=WorkflowService(session_maker=seeded),
        credentials=CredentialQueryRepository(session_factory=seeded),
        skills=create_autospec(AgentSkillReader, instance=True),
    )
    with pytest.raises(expected_error):
        application(lifecycle).publish(CONTEXT, "app-1", marked_name="Rejected", marked_comment="")
    with seeded() as session:
        app = session.get(App, "app-1")
        assert app is not None
        assert app.workflow_id == "published"
        assert session.scalar(select(Workflow.id).where(Workflow.marked_name == "Rejected")) is None


def test_restore_preserves_historical_features_without_normalizing_persisted_source(
    seeded: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    features = json.dumps(
        {
            "file_upload": {
                "image": {"enabled": True, "number_limits": 6, "transfer_methods": ["remote_url", "local_file"]}
            }
        }
    )
    with seeded.begin() as session:
        workflow = session.get(Workflow, "published")
        assert workflow is not None
        workflow.features = features
    monkeypatch.setattr(gateway_module.app_draft_workflow_was_synced, "send", lambda *_args, **_kwargs: None)
    lifecycle = WorkflowDefinitionGateway(
        session_factory=seeded,
        drafts=WorkflowDraftRepository(seeded),
        definitions=WorkflowDefinitionRepository(session_factory=seeded),
        workflows=WorkflowService(session_maker=seeded),
        credentials=CredentialQueryRepository(session_factory=seeded),
        skills=create_autospec(AgentSkillReader, instance=True),
    )
    application(lifecycle).restore(CONTEXT, "app-1", "published")
    with seeded() as session:
        for workflow_id in ["draft", "published"]:
            workflow = session.get(Workflow, workflow_id)
            assert workflow is not None
            assert workflow.serialized_features == features


def test_publication_serializes_on_app_and_closes_the_transaction(
    seeded: sessionmaker[Session],
) -> None:
    locks: list[Session] = []

    def capture(execution: ORMExecuteState) -> None:
        if not isinstance(execution.statement, Select):
            return
        sql = str(execution.statement.compile(dialect=postgresql.dialect()))
        if "FROM apps" in sql and "FOR UPDATE" in sql:
            locks.append(execution.session)

    lifecycle = WorkflowDefinitionGateway(
        session_factory=seeded,
        drafts=WorkflowDraftRepository(seeded),
        definitions=WorkflowDefinitionRepository(session_factory=seeded),
        workflows=WorkflowService(session_maker=seeded),
        credentials=CredentialQueryRepository(session_factory=seeded),
        skills=create_autospec(AgentSkillReader, instance=True),
    )
    event.listen(seeded, "do_orm_execute", capture)
    try:
        application(lifecycle).publish(CONTEXT, "app-1", marked_name="Release", marked_comment="")
    finally:
        event.remove(seeded, "do_orm_execute", capture)
    assert len(locks) == 1
    assert all(not session.in_transaction() for session in locks)


@pytest.mark.parametrize("over_limit", [False, True])
def test_migration_uses_the_same_atomic_publication_boundary(
    seeded: sessionmaker[Session], over_limit: bool, *, workflow_tools: WorkflowToolManageService
) -> None:
    app_id = str(uuid4())
    with seeded.begin() as session:
        session.add(make_app(app_id=app_id, mode=AppMode.WORKFLOW, created_by="account-1"))
        session.add(
            make_workflow(
                app_id=app_id,
                graph={
                    "nodes": [
                        {"id": str(index), "data": {"type": "trigger-webhook", "title": "Webhook"}}
                        for index in range(6 if over_limit else 1)
                    ],
                    "edges": [],
                },
            )
        )
    lifecycle = WorkflowDefinitionGateway(
        session_factory=seeded,
        drafts=WorkflowDraftRepository(seeded),
        definitions=WorkflowDefinitionRepository(session_factory=seeded),
        workflows=WorkflowService(session_maker=seeded),
        credentials=CredentialQueryRepository(session_factory=seeded),
        skills=create_autospec(AgentSkillReader, instance=True),
    )
    migration = MigrationImportService(workflows=application(lifecycle), app_dsl=Mock(), workflow_tools=workflow_tools)
    with seeded() as session:
        actor = session.get(Account, "account-1")
        assert actor is not None
        target = ImportTarget("tenant-1", "Test", actor.id, actor.email)
        if over_limit:
            with pytest.raises(ValueError, match="maximum webhook node limit"):
                migration._ensure_workflow_app_is_published(target, actor, app_id, session=session)
        else:
            migration._ensure_workflow_app_is_published(target, actor, app_id, session=session)
        app = session.get(App, app_id)
        assert app is not None
        if over_limit:
            assert app.workflow_id is None
        else:
            assert app.workflow_id is not None
            assert session.get(Workflow, app.workflow_id) is not None
            from models.trigger import WorkflowWebhookTrigger

            assert (
                session.scalar(select(WorkflowWebhookTrigger).where(WorkflowWebhookTrigger.app_id == app_id))
                is not None
            )


def configure_runtime_draft(factory: sessionmaker[Session], name: str) -> None:
    with factory.begin() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        draft.graph = json.dumps(
            {
                "nodes": [
                    {"id": f"webhook-{name}", "data": {"type": "trigger-webhook", "title": name}},
                    {
                        "id": f"plugin-{name}",
                        "data": {
                            "type": "trigger-plugin",
                            "title": name,
                            "provider_id": "test/provider",
                            "event_name": "created",
                            "subscription_id": f"subscription-{name}",
                        },
                    },
                    {
                        "id": f"schedule-{name}",
                        "data": {
                            "type": "trigger-schedule",
                            "title": name,
                            "mode": "cron",
                            "cron_expression": "0 * * * *",
                            "timezone": "UTC",
                        },
                    },
                ],
                "edges": [],
            }
        )


def assert_runtime_configuration(factory: sessionmaker[Session], name: str) -> str:
    from models.trigger import AppTrigger, WorkflowPluginTrigger, WorkflowSchedulePlan, WorkflowWebhookTrigger

    with factory() as session:
        app = session.get(App, "app-1")
        assert app is not None
        version = session.get(Workflow, app.workflow_id)
        assert version is not None
        assert version.marked_name == name
        assert set(session.scalars(select(AppTrigger.node_id).where(AppTrigger.app_id == app.id))) == {
            f"webhook-{name}",
            f"plugin-{name}",
            f"schedule-{name}",
        }
        webhook = session.scalars(select(WorkflowWebhookTrigger).where(WorkflowWebhookTrigger.app_id == app.id)).one()
        assert webhook.node_id == f"webhook-{name}"
        assert len(webhook.webhook_id) == 24
        plugin = session.scalars(select(WorkflowPluginTrigger).where(WorkflowPluginTrigger.app_id == app.id)).one()
        assert plugin.node_id == f"plugin-{name}"
        assert plugin.subscription_id == f"subscription-{name}"
        schedule = session.scalars(select(WorkflowSchedulePlan).where(WorkflowSchedulePlan.app_id == app.id)).one()
        assert schedule.node_id == f"schedule-{name}"
        assert schedule.next_run_at is not None
        assert schedule.cron_expression == "0 * * * *"
        return version.id


def test_redis_outage_cannot_leave_a_successful_publication_without_runtime_configuration(
    seeded: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from redis.exceptions import ConnectionError as RedisConnectionError

    from extensions.ext_redis import redis_client

    configure_runtime_draft(seeded, "A")
    lifecycle = WorkflowDefinitionGateway(
        session_factory=seeded,
        drafts=WorkflowDraftRepository(seeded),
        definitions=WorkflowDefinitionRepository(session_factory=seeded),
        workflows=WorkflowService(session_maker=seeded),
        credentials=CredentialQueryRepository(session_factory=seeded),
        skills=create_autospec(AgentSkillReader, instance=True),
    )

    def unavailable() -> None:
        raise RedisConnectionError("Redis temporarily unavailable")

    monkeypatch.setattr(redis_client, "_require_client", unavailable)
    application(lifecycle).publish(CONTEXT, "app-1", marked_name="A", marked_comment="")
    assert_runtime_configuration(seeded, "A")


def test_trigger_storage_failure_rolls_back_version_pointer_and_every_projection(
    seeded: sessionmaker[Session],
) -> None:
    from models.trigger import WorkflowSchedulePlan

    configure_runtime_draft(seeded, "A")
    lifecycle = WorkflowDefinitionGateway(
        session_factory=seeded,
        drafts=WorkflowDraftRepository(seeded),
        definitions=WorkflowDefinitionRepository(session_factory=seeded),
        workflows=WorkflowService(session_maker=seeded),
        credentials=CredentialQueryRepository(session_factory=seeded),
        skills=create_autospec(AgentSkillReader, instance=True),
    )
    service = application(lifecycle)
    service.publish(CONTEXT, "app-1", marked_name="A", marked_comment="")
    original_version = assert_runtime_configuration(seeded, "A")
    configure_runtime_draft(seeded, "B")

    def reject_schedule_update(session: Session, _context: object, _instances: object) -> None:
        # This fails after webhook/plugin writes have flushed, exercising real rollback.
        for value in session.dirty:
            if isinstance(value, WorkflowSchedulePlan) and value.node_id == "schedule-B":
                raise RuntimeError("schedule storage unavailable")

    event.listen(seeded, "before_flush", reject_schedule_update)
    try:
        with pytest.raises(RuntimeError, match="schedule storage unavailable"):
            service.publish(CONTEXT, "app-1", marked_name="B", marked_comment="")
    finally:
        event.remove(seeded, "before_flush", reject_schedule_update)
    assert assert_runtime_configuration(seeded, "A") == original_version
    with seeded() as session:
        assert session.scalar(select(Workflow.id).where(Workflow.marked_name == "B")) is None
        counter = session.get(WorkflowVersionCounter, "app-1")
        assert counter is not None
        assert counter.last_version_number == 2


def test_republication_replaces_all_trigger_configuration(
    seeded: sessionmaker[Session],
) -> None:
    lifecycle = WorkflowDefinitionGateway(
        session_factory=seeded,
        drafts=WorkflowDraftRepository(seeded),
        definitions=WorkflowDefinitionRepository(session_factory=seeded),
        workflows=WorkflowService(session_maker=seeded),
        credentials=CredentialQueryRepository(session_factory=seeded),
        skills=create_autospec(AgentSkillReader, instance=True),
    )
    for name in ["A", "B"]:
        configure_runtime_draft(seeded, name)
        application(lifecycle).publish(CONTEXT, "app-1", marked_name=name, marked_comment="")
        assert_runtime_configuration(seeded, name)


def test_draft_webhook_receiver_uses_injected_database(
    seeded: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from events.event_handlers.sync_webhook_when_app_created import handle
    from models.trigger import WorkflowWebhookTrigger
    from services.trigger import webhook_service

    configure_runtime_draft(seeded, "draft")
    with seeded() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        snapshot = workflow_snapshot(draft)
    monkeypatch.setattr(webhook_service, "db", object())
    monkeypatch.setattr(gateway_module.app_draft_workflow_was_synced, "receivers_for", lambda _app: iter([handle]))
    lifecycle = WorkflowDefinitionGateway(
        session_factory=seeded,
        drafts=WorkflowDraftRepository(seeded),
        definitions=WorkflowDefinitionRepository(session_factory=seeded),
        workflows=WorkflowService(session_maker=seeded),
        credentials=CredentialQueryRepository(session_factory=seeded),
        skills=create_autospec(AgentSkillReader, instance=True),
    )
    lifecycle.draft_synced(CONTEXT, WorkflowOwner("app-1"), snapshot)
    with seeded() as session:
        assert session.scalars(select(WorkflowWebhookTrigger.node_id)).all() == ["webhook-draft"]


@pytest.mark.parametrize("retained", [set(), {"kept"}])
def test_dataset_sync_removes_every_duplicate_stale_relationship(
    seeded: sessionmaker[Session], retained: set[str]
) -> None:
    with seeded.begin() as session:
        session.add_all(
            [AppDatasetJoin(app_id="app-1", dataset_id=value) for value in ["removed", "removed", "kept", "kept"]]
        )
        session.add(AppDatasetJoin(app_id="other-app", dataset_id="removed"))
    with seeded.begin() as session:
        app = session.get(App, "app-1")
        assert app is not None
        WorkflowDefinitionStore.sync_dataset_relationships(session, app, retained)
    with seeded() as session:
        assert (
            set(session.scalars(select(AppDatasetJoin.dataset_id).where(AppDatasetJoin.app_id == "app-1"))) == retained
        )
        assert (
            session.scalars(select(AppDatasetJoin).where(AppDatasetJoin.app_id == "other-app")).one().dataset_id
            == "removed"
        )


@pytest.mark.parametrize("field", ["environment", "conversation"])
def test_variable_updates_lock_the_owned_draft_and_close_their_transaction(
    seeded: sessionmaker[Session], field: str
) -> None:
    repository = WorkflowDraftRepository(seeded)
    snapshot = repository.snapshot(CONTEXT, WorkflowOwner("app-1"))
    assert snapshot is not None
    sessions: list[Session] = []
    locked_statements: list[str] = []

    def capture(execution: ORMExecuteState) -> None:
        if not isinstance(execution.statement, Select):
            return
        statement = str(execution.statement.compile(dialect=postgresql.dialect()))
        if "FOR UPDATE" in statement:
            sessions.append(execution.session)
            locked_statements.append(statement)

    event.listen(seeded, "do_orm_execute", capture)
    variables = [StringVariable(id="changed", name="changed", value="new")]
    try:
        repository.update_draft_variables(
            CONTEXT,
            "app-1",
            expected=snapshot,
            environment_variables=prepare_environment_variables(
                tenant_id="tenant-1", source=snapshot, variables=variables
            ).value
            if field != "conversation"
            else None,
            conversation_variables=variables if field == "conversation" else None,
        )
    finally:
        event.remove(seeded, "do_orm_execute", capture)
    assert len(locked_statements) == 2
    assert "FROM apps" in locked_statements[0]
    assert all(
        column in locked_statements[1] for column in ["workflows.app_id", "workflows.tenant_id", "workflows.version"]
    )
    assert all(not session.in_transaction() for session in sessions)
    with seeded() as session:
        workflow = session.get(Workflow, "draft")
        assert workflow is not None
        actual = workflow.conversation_variables if field == "conversation" else workflow.environment_variables
        assert [(v.id, v.value) for v in actual] == [("changed", "new")]
        assert workflow.updated_by == "account-1"
        assert workflow.updated_at is not None


def test_variable_update_does_not_commit_an_ambient_session(seeded: sessionmaker[Session]) -> None:
    repository = WorkflowDraftRepository(seeded)
    with seeded() as caller:
        caller.add(make_account(account_id="uncommitted", email="uncommitted@example.com"))
        snapshot = repository.snapshot(CONTEXT, WorkflowOwner("app-1"))
        assert snapshot is not None
        repository.update_draft_variables(
            CONTEXT,
            "app-1",
            expected=snapshot,
            environment_variables="{}",
            conversation_variables=None,
        )
        with seeded() as reader:
            assert reader.get(Account, "uncommitted") is None
        assert caller.new
        caller.rollback()


def test_variable_update_commit_failure_rolls_back_all_fields(seeded: sessionmaker[Session]) -> None:
    repository = WorkflowDraftRepository(seeded)
    with seeded() as session:
        before = session.get(Workflow, "draft")
        assert before is not None
        snapshot = workflow_snapshot(before)

    def fail_commit(_session: Session) -> None:
        raise RuntimeError("commit failed")

    event.listen(seeded, "before_commit", fail_commit)
    try:
        with pytest.raises(RuntimeError, match="commit failed"):
            repository.update_draft_variables(
                CONTEXT,
                "app-1",
                expected=snapshot,
                environment_variables=prepare_environment_variables(
                    tenant_id="tenant-1",
                    source=snapshot,
                    variables=[StringVariable(id="new-env", name="key", value="value")],
                ).value,
                conversation_variables=[StringVariable(id="new-conv", name="topic", value="value")],
            )
    finally:
        event.remove(seeded, "before_commit", fail_commit)
    with seeded() as session:
        after = session.get(Workflow, "draft")
        assert after is not None
        assert workflow_snapshot(after) == snapshot


def test_variable_update_rejects_another_tenant(seeded: sessionmaker[Session]) -> None:
    repository = WorkflowDraftRepository(seeded)
    snapshot = repository.snapshot(CONTEXT, WorkflowOwner("app-1"))
    assert snapshot is not None
    with pytest.raises(ConsoleAppNotFoundError):
        repository.update_draft_variables(
            CONTEXT._replace(active_workspace_id="other-tenant"),
            "app-1",
            expected=snapshot,
            environment_variables="{}",
            conversation_variables=None,
        )


def test_republish_without_schedule_removes_the_runtime_plan(seeded: sessionmaker[Session]) -> None:
    from models.trigger import WorkflowSchedulePlan

    configure_runtime_draft(seeded, "scheduled")
    lifecycle = WorkflowDefinitionGateway(
        session_factory=seeded,
        drafts=WorkflowDraftRepository(seeded),
        definitions=WorkflowDefinitionRepository(session_factory=seeded),
        workflows=WorkflowService(session_maker=seeded),
        credentials=CredentialQueryRepository(session_factory=seeded),
        skills=create_autospec(AgentSkillReader, instance=True),
    )
    service = application(lifecycle)
    service.publish(CONTEXT, "app-1", marked_name="Scheduled", marked_comment="")
    with seeded.begin() as session:
        assert session.scalar(select(WorkflowSchedulePlan).where(WorkflowSchedulePlan.app_id == "app-1")) is not None
        draft = session.get(Workflow, "draft")
        assert draft is not None
        draft.graph = json.dumps({"nodes": [], "edges": []})
    service.publish(CONTEXT, "app-1", marked_name="Unscheduled", marked_comment="")
    with seeded() as session:
        assert session.scalar(select(WorkflowSchedulePlan).where(WorkflowSchedulePlan.app_id == "app-1")) is None


@pytest.mark.parametrize("rollback", [False, True])
def test_agent_bindings_and_active_version_share_the_publication_transaction(
    seeded: sessionmaker[Session], rollback: bool
) -> None:
    from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource
    from models.agent_config_entities import AgentSoulConfig, AgentSoulModelConfig
    from services.workflow.publication_service import prepare_publication, publish_workflow

    with seeded.begin() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        draft.graph = json.dumps(
            {
                "nodes": [
                    {
                        "id": "agent-node",
                        "data": {
                            "type": "agent",
                            "version": "2",
                            "agent_node_kind": "dify_agent",
                        },
                    }
                ],
                "edges": [],
            }
        )
        session.add_all(
            [
                Agent(
                    id="roster",
                    tenant_id="tenant-1",
                    name="Roster",
                    scope=AgentScope.ROSTER,
                    source=AgentSource.ROSTER,
                    active_config_snapshot_id="agent-config",
                ),
                AgentConfigSnapshot(
                    id="agent-config",
                    tenant_id="tenant-1",
                    agent_id="roster",
                    version=1,
                    config_snapshot=AgentSoulConfig(
                        model=AgentSoulModelConfig(
                            plugin_id="langgenius/openai",
                            model_provider="openai",
                            model="test-model",
                        )
                    ),
                ),
                WorkflowAgentNodeBinding(
                    tenant_id="tenant-1",
                    app_id="app-1",
                    workflow_id="draft",
                    workflow_version="draft",
                    node_id="agent-node",
                    binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                    agent_id="roster",
                    current_snapshot_id="agent-config",
                    node_job_config={},
                    created_by="account-1",
                ),
            ]
        )
    with seeded() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        snapshot = workflow_snapshot(draft)
    repository = WorkflowDefinitionRepository(session_factory=seeded)
    published_id = ""

    with repository.binding_reader() as bindings:
        agents = WorkflowAgentPublishService(repository=bindings).publication_state(draft_workflow=snapshot)

    def publish() -> None:
        nonlocal published_id
        with repository.publication(CONTEXT, "app-1", snapshot) as transaction:
            published = publish_workflow(
                transaction,
                prepare_publication(snapshot),
                agent_service=WorkflowAgentPublishService(repository=transaction.bindings),
                agents=agents,
                marked_name="Agents",
                marked_comment="",
            )
            published_id = published.id
            if rollback:
                raise RuntimeError("rollback after binding copy and activation")

    if rollback:
        with pytest.raises(RuntimeError, match="rollback after binding copy"):
            publish()
    else:
        publish()
    with seeded() as session:
        app = session.get(App, "app-1")
        assert app is not None
        assert app.workflow_id == ("published" if rollback else published_id)
        assert (session.get(Workflow, published_id) is None) is rollback
        bindings = list(
            session.scalars(
                select(WorkflowAgentNodeBinding).where(
                    WorkflowAgentNodeBinding.workflow_id == published_id,
                )
            )
        )
        assert len(bindings) == (0 if rollback else 1)
        if bindings:
            assert bindings[0].current_snapshot_id == "agent-config"
        assert (
            session.scalar(
                select(func.count())
                .select_from(WorkflowAgentNodeBinding)
                .where(
                    WorkflowAgentNodeBinding.workflow_id == "draft",
                )
            )
            == 1
        )


@pytest.mark.parametrize("concurrent_edit", [None, "graph", "binding", "agent-snapshot"])
def test_skill_archive_validation_releases_connections_and_rechecks_agent_state(
    seeded: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, concurrent_edit: str | None
) -> None:
    import io
    import zipfile

    from sqlalchemy.engine import Engine
    from sqlalchemy.pool import QueuePool

    from extensions.application_services.workflow import build_workflow_definition_gateway
    from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource
    from models.agent_config_entities import AgentSoulConfig, AgentSoulModelConfig, AgentSoulPromptConfig
    from models.skill import AgentSkillBindingSnapshot, Skill, SkillVersion, SkillVersionManifest
    from models.tools import ToolFile

    soul = AgentSoulConfig(
        model=AgentSoulModelConfig(plugin_id="langgenius/openai", model_provider="openai", model="test"),
        prompt=AgentSoulPromptConfig(system_prompt="Use [§skill:archived-skill§]"),
    )
    with seeded.begin() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        draft.graph = json.dumps(
            {
                "nodes": [{"id": "agent", "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}}],
                "edges": [],
            }
        )
        archive = ToolFile(
            tenant_id="tenant-1",
            user_id="account-1",
            conversation_id=None,
            file_key="skills/published.zip",
            mimetype="application/zip",
        )
        session.add_all(
            [
                archive,
                Agent(
                    id="agent",
                    tenant_id="tenant-1",
                    name="Agent",
                    scope=AgentScope.ROSTER,
                    source=AgentSource.ROSTER,
                    active_config_snapshot_id="soul",
                ),
                AgentConfigSnapshot(id="soul", tenant_id="tenant-1", agent_id="agent", version=1, config_snapshot=soul),
                AgentConfigSnapshot(
                    id="new-soul", tenant_id="tenant-1", agent_id="agent", version=2, config_snapshot=soul
                ),
                WorkflowAgentNodeBinding(
                    id="binding",
                    tenant_id="tenant-1",
                    app_id="app-1",
                    workflow_id="draft",
                    workflow_version="draft",
                    node_id="agent",
                    binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                    agent_id="agent",
                    current_snapshot_id="soul",
                    node_job_config={},
                    created_by="account-1",
                ),
                Skill(
                    id="skill",
                    tenant_id="tenant-1",
                    name="draft-name",
                    display_name="Skill",
                    latest_published_version_id="version",
                ),
                SkillVersion(
                    id="version",
                    skill_id="skill",
                    version_number=1,
                    manifest=SkillVersionManifest(files=[]),
                    archive_tool_file_id=archive.id,
                    hash_code="hash",
                    archive_size=123,
                ),
                AgentSkillBindingSnapshot(
                    tenant_id="tenant-1", agent_id="agent", config_snapshot_id="soul", skill_id="skill", priority=0
                ),
            ]
        )
    archive_bytes = io.BytesIO()
    with zipfile.ZipFile(archive_bytes, "w") as zip_file:
        zip_file.writestr("SKILL.md", "---\nname: archived-skill\ndescription: Published skill\n---\nInstructions")
    sessions: list[Session] = []
    statements: list[str] = []
    downloads: list[str] = []

    def opened(session: Session, _transaction: object, _connection: object) -> None:
        sessions.append(session)

    def query(execution: ORMExecuteState) -> None:
        if isinstance(execution.statement, Select):
            statements.append(str(execution.statement.compile(dialect=postgresql.dialect())))

    def load(key: str) -> bytes:
        assert all(not session.in_transaction() for session in sessions)
        engine = seeded.kw["bind"]
        assert isinstance(engine, Engine)
        assert isinstance(engine.pool, QueuePool)
        assert engine.pool.checkedout() == 0
        assert not any("FOR UPDATE" in statement for statement in statements)
        downloads.append(key)
        if concurrent_edit:
            with seeded.begin() as session:
                if concurrent_edit == "graph":
                    draft = session.get(Workflow, "draft")
                    assert draft is not None
                    draft.graph = '{"nodes": [], "edges": []}'
                elif concurrent_edit == "binding":
                    binding = session.get(WorkflowAgentNodeBinding, "binding")
                    assert binding is not None
                    session.delete(binding)
                else:
                    agent = session.get(Agent, "agent")
                    assert agent is not None
                    agent.active_config_snapshot_id = "new-soul"
        return archive_bytes.getvalue()

    monkeypatch.setattr("services.skill_management_service.storage.load_once", load)
    console_variables = build_console_workflow_variables(
        database_client=seeded, variables=build_workflow_variable_service(database_client=seeded)
    )
    with seeded.begin() as session:
        app = session.get(App, "app-1")
        assert app is not None
        app.mode = AppMode.ADVANCED_CHAT
    workflows = WorkflowService(seeded)
    monkeypatch.setattr(workflows, "validate_graph_structure", lambda **_kwargs: None)
    definitions = WorkflowDefinitionRepository(session_factory=seeded)
    service = application(
        build_workflow_definition_gateway(seeded, definitions, workflows, drafts=WorkflowDraftRepository(seeded))
    )
    event.listen(seeded, "after_begin", opened)
    event.listen(seeded, "do_orm_execute", query)
    try:
        if concurrent_edit:
            with pytest.raises(WorkflowHashNotEqualError):
                service.publish(CONTEXT, "app-1", marked_name="Skill", marked_comment="")
        else:
            service.publish(CONTEXT, "app-1", marked_name="Skill", marked_comment="")
    finally:
        event.remove(seeded, "after_begin", opened)
        event.remove(seeded, "do_orm_execute", query)
    assert downloads == ["skills/published.zip"]
    with seeded() as session:
        app = session.get(App, "app-1")
        assert app is not None
        assert (app.workflow_id == "published") is bool(concurrent_edit)
        versions = session.scalar(select(func.count()).select_from(Workflow).where(Workflow.version != "draft"))
        assert versions == (1 if concurrent_edit else 2)


@pytest.mark.parametrize("rollback", [False, True])
@pytest.mark.parametrize("packaged", [False, True])
def test_dsl_draft_and_app_share_outer_commit_and_effects(
    seeded: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, rollback: bool, packaged: bool
) -> None:
    from extensions.application_services.workflow import build_app_dsl_service
    from services.agent.dsl_service import AgentDslService
    from services.agent.retirement_service import WorkflowAgentRetirementService
    from services.entities.dsl_entities import DslImportWarning

    effects: list[object] = []
    locks: list[str] = []

    def query(execution: ORMExecuteState) -> None:
        statement = execution.statement
        if (
            isinstance(statement, Select)
            and Workflow.__table__ in statement.get_final_froms()
            and "FOR UPDATE" in str(statement.compile(dialect=postgresql.dialect()))
        ):
            locks.append(str(statement.compile(dialect=postgresql.dialect())))

    def retire(**kwargs: object) -> None:
        assert not outer.in_transaction()
        effects.append(kwargs["agent_ids"])

    def notify(_app: App, **kwargs: object) -> None:
        assert not outer.in_transaction()
        workflow = kwargs["synced_draft_workflow"]
        assert isinstance(workflow, Workflow)
        effects.append(workflow.graph_dict)

    def materialize(
        _service: AgentDslService, **kwargs: object
    ) -> tuple[dict[str, object], list[DslImportWarning], set[str]]:
        assert outer.in_transaction()
        workflow = kwargs["workflow"]
        assert isinstance(workflow, WorkflowSnapshot)
        assert workflow.app_id == "app-1"
        # A dependent import write must be part of the same transaction.
        outer.add(make_workflow(workflow_id="import-dependent", app_id="other-app"))
        return {"nodes": [], "edges": [], "materialized": True}, [], {"removed-agent"}

    monkeypatch.setattr(WorkflowAgentRetirementService, "retire_unowned", staticmethod(retire))
    monkeypatch.setattr(AgentDslService, "import_workflow_packages", materialize)
    event.listen(seeded, "do_orm_execute", query)
    gateway_module.app_draft_workflow_was_synced.connect(notify, weak=False)
    try:
        with seeded() as outer:
            app, account = outer.get(App, "app-1"), outer.get(Account, "account-1")
            assert app is not None
            assert account is not None
            build_app_dsl_service(outer)._create_or_update_app(
                app=app,
                account=account,
                data={
                    "app": {"mode": "workflow", "name": "Imported"},
                    "workflow": {"graph": {"nodes": [], "edges": [], "imported": True}},
                    "agent_packages": {"package": {}} if packaged else {},
                },
            )
            assert effects == []
            assert len(locks) == 1
            if rollback:
                outer.rollback()
                # Reusing the session must not resurrect rolled-back effects.
                outer.commit()
            else:
                outer.commit()
            assert effects == (
                []
                if rollback
                else [
                    ["removed-agent"] if packaged else [],
                    {"nodes": [], "edges": [], "materialized" if packaged else "imported": True},
                ]
            )
    finally:
        event.remove(seeded, "do_orm_execute", query)
        gateway_module.app_draft_workflow_was_synced.disconnect(notify)
    with seeded() as session:
        app, draft = session.get(App, "app-1"), session.get(Workflow, "draft")
        assert app is not None
        assert draft is not None
        assert (app.name == "Imported") is not rollback
        assert bool(draft.graph_dict.get("materialized" if packaged else "imported")) is not rollback
        assert (session.get(Workflow, "import-dependent") is not None) is (packaged and not rollback)


@pytest.mark.parametrize("state", ["new", "replace", "stale", "collaborative"])
def test_shared_draft_writer_preserves_hash_and_variable_rules(seeded: sessionmaker[Session], state: str) -> None:
    from extensions.application_services.workflow import build_workflow_definition_gateway

    with seeded.begin() as session:
        draft = session.get(Workflow, "draft")
        assert draft is not None
        draft.environment_variables = [StringVariable(id="server", name="SERVER", value="server")]
        draft.features = '{"server": true}'
        previous_hash = draft.unique_hash
        if state == "new":
            session.delete(draft)
    definitions = WorkflowDefinitionRepository(session_factory=seeded)
    lifecycle = build_workflow_definition_gateway(
        seeded, definitions, WorkflowService(seeded), drafts=WorkflowDraftRepository(seeded)
    )
    service = application(lifecycle)
    command = DraftSyncCommand(
        graph={"nodes": [], "edges": [], "edited": True},
        features={"client": True},
        unique_hash="stale" if state == "stale" else previous_hash,
        is_collaborative=state == "collaborative",
        environment_upserts=None,
        environment_deletions=[],
        conversation_variables=[],
        environment_variables=[{"id": "client", "name": "CLIENT", "value_type": "string", "value": "client"}],
    )
    if state == "stale":
        with pytest.raises(WorkflowHashNotEqualError):
            service.sync(CONTEXT, "app-1", command)
    else:
        result = service.sync(CONTEXT, "app-1", command)
        assert result.hash != previous_hash
    with seeded() as session:
        draft = session.scalar(select(Workflow).where(Workflow.app_id == "app-1", Workflow.version == "draft"))
        assert draft is not None
        preserve = state in {"stale", "collaborative"}
        assert draft.features_dict.get("server", False) is preserve
        assert draft.features_dict.get("client", False) is not preserve
        assert {variable.name: variable.value for variable in draft.environment_variables} == (
            {"SERVER": "server"} if preserve else {"CLIENT": "client"}
        )
        assert bool(draft.graph_dict.get("edited")) is (state != "stale")


@pytest.mark.parametrize("snippet", [False, True])
def test_publication_repository_is_independent_of_agent_service_and_commits_requested_operations(
    seeded: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, snippet: bool
) -> None:
    from models.snippet import CustomizedSnippet, SnippetType
    from models.workflow import WorkflowKind
    from repositories.agent.workflow_binding_repository import WorkflowAgentBindingRepository
    from repositories.workflow.snippet_publication_repository import SnippetPublicationRepository

    # A repository must not instantiate or invoke Agent business orchestration,
    # even if it used to receive that service hidden behind a factory/Protocol.
    monkeypatch.setattr(
        WorkflowAgentPublishService, "__init__", Mock(side_effect=AssertionError("repository called service"))
    )
    if snippet:
        with seeded.begin() as session:
            session.add(
                CustomizedSnippet(
                    id="app-1", tenant_id="tenant-1", name="Snippet", type=SnippetType.NODE, created_by="account-1"
                )
            )
            draft = session.get(Workflow, "draft")
            assert draft is not None
            draft.kind = WorkflowKind.SNIPPET
        snippets = SnippetPublicationRepository(seeded)
        with snippets.draft(tenant_id="tenant-1", snippet_id="app-1") as (source, bindings):
            assert isinstance(bindings, WorkflowAgentBindingRepository)
        with snippets.publication(source) as transaction:
            workflow = transaction.create_version(account_id="account-1")
            transaction.activate(workflow, account_id="account-1")
        with seeded() as session:
            row = session.get(CustomizedSnippet, "app-1")
            assert row is not None
            assert row.is_published is True
            assert session.get(Workflow, workflow.id) is not None
    else:
        definitions = WorkflowDefinitionRepository(session_factory=seeded)
        with definitions.draft(CONTEXT, "app-1") as read:
            assert read is not None
            assert isinstance(read.bindings, WorkflowAgentBindingRepository)
            source = read.workflow
        with definitions.publication(CONTEXT, "app-1", source) as publication:
            created = publication.create_version(marked_name="Published", marked_comment="")
            publication.activate(created)
            assert isinstance(publication.bindings, WorkflowAgentBindingRepository)
        with seeded() as session:
            app = session.get(App, "app-1")
            assert app is not None
            assert app.workflow_id == created.id
            assert session.get(Workflow, created.id) is not None
