"""Dependency discovery uses real persisted definitions and complete owner chains."""

import json
from uuid import uuid4

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.tools.entities.tool_entities import ApiProviderSchemaType
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from models.dataset import Dataset, Document, ExternalKnowledgeApis, ExternalKnowledgeBindings
from models.model import App, AppMode, AppModelConfig
from models.tools import ApiToolProvider, BuiltinToolProvider, MCPToolProvider, WorkflowToolProvider
from models.workflow import Workflow, WorkflowType
from repositories.app.availability_repository import AppAvailabilityRepository
from services.entities.app_entities import (
    AppAvailabilityPlan,
    AppModelDependency,
    AppPluginDependency,
    AppToolDependency,
)

TENANT = str(uuid4())
ACTOR = str(uuid4())
MODEL = {"provider": "langgenius/openai/openai", "name": "gpt-example"}


def app(session: Session, mode: AppMode = AppMode.WORKFLOW, **values: object) -> App:
    result = App(tenant_id=TENANT, name="Example", mode=mode, enable_site=True, enable_api=True, **values)
    session.add(result)
    session.flush()
    return result


def workflow(
    session: Session, owner: App, nodes: list[dict[str, object]], version: str = "draft", **values: object
) -> Workflow:
    result = Workflow(
        tenant_id=owner.tenant_id,
        app_id=owner.id,
        type=WorkflowType.WORKFLOW,
        version=version,
        graph=json.dumps({"nodes": nodes, "edges": []}),
        _features="{}",
        created_by=ACTOR,
        **values,
    )
    session.add(result)
    session.flush()
    return result


def llm(model: str = MODEL["name"]) -> dict[str, object]:
    return {"id": model, "data": {"type": "llm", "model": {**MODEL, "name": model}}}


def collect(session: Session, owner: App) -> AppAvailabilityPlan:
    return AppAvailabilityRepository(session=session, tenant_id=TENANT).collect(owner)


@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
def test_studio_checks_draft_even_when_a_published_workflow_exists(sqlite_session: Session, mode: AppMode) -> None:
    owner = app(sqlite_session, mode)
    published = workflow(sqlite_session, owner, [llm("published")], version="v1")
    workflow(sqlite_session, owner, [llm("draft")])
    owner.workflow_id = published.id
    plan = collect(sqlite_session, owner)
    assert plan.source == "draft"
    assert [d.model for d in plan.dependencies if isinstance(d, AppModelDependency)] == ["draft"]
    assert not plan.reasons


def test_unpublished_workflow_uses_draft(sqlite_session: Session) -> None:
    owner = app(sqlite_session)
    workflow(sqlite_session, owner, [llm()])
    plan = collect(sqlite_session, owner)
    assert plan.source == "draft"
    assert plan.dependencies == (AppModelDependency(MODEL["provider"], MODEL["name"], "llm", MODEL["name"]),)


def test_draft_workflows_are_loaded_once_for_an_authorized_batch(sqlite_session: Session) -> None:
    owners = [app(sqlite_session) for _ in range(8)]
    for owner in owners[:-1]:
        workflow(sqlite_session, owner, [llm()])
    statements: list[str] = []

    def executed(_connection: object, _cursor: object, statement: str, *_args: object) -> None:
        statements.append(statement)

    connection = sqlite_session.connection()
    event.listen(connection, "before_cursor_execute", executed)
    try:
        plans = AppAvailabilityRepository(session=sqlite_session, tenant_id=TENANT).collect_many(owners)
    finally:
        event.remove(connection, "before_cursor_execute", executed)
    assert all(plan.source == "draft" for plan in plans.values())
    assert all(not plans[owner.id].reasons for owner in owners[:-1])
    assert plans[owners[-1].id].reasons[0].reason == "not-configured"
    assert len(statements) == 1


@pytest.mark.parametrize("case", ["foreign_tenant", "wrong_app", "deleted"])
def test_studio_draft_does_not_depend_on_the_published_reference(sqlite_session: Session, case: str) -> None:
    owner = app(sqlite_session)
    other = app(sqlite_session)
    published = workflow(sqlite_session, other if case == "wrong_app" else owner, [llm("secret")], "v1")
    if case == "foreign_tenant":
        published.tenant_id = str(uuid4())
    owner.workflow_id = str(uuid4()) if case == "deleted" else published.id
    workflow(sqlite_session, owner, [llm("draft")])
    sqlite_session.flush()
    plan = collect(sqlite_session, owner)
    assert plan.source == "draft"
    assert not plan.reasons
    assert [d.model for d in plan.dependencies if isinstance(d, AppModelDependency)] == ["draft"]


@pytest.mark.parametrize("case", ["missing", "foreign_tenant"])
def test_studio_never_substitutes_a_published_workflow_for_a_missing_draft(sqlite_session: Session, case: str) -> None:
    owner = app(sqlite_session)
    published = workflow(sqlite_session, owner, [llm("published")], "v1")
    owner.workflow_id = published.id
    if case == "foreign_tenant":
        draft = workflow(sqlite_session, owner, [llm("secret")])
        draft.tenant_id = str(uuid4())
        sqlite_session.flush()
    plan = collect(sqlite_session, owner)
    assert plan.source == "draft"
    assert [(r.type, r.reason) for r in plan.reasons] == [("workflow", "not-configured")]
    assert not plan.dependencies


@pytest.mark.parametrize("graph", ['{"nodes":[]}', '{"nodes":null}', "invalid"])
def test_unconfigured_or_corrupt_workflow_is_not_healthy(sqlite_session: Session, graph: str) -> None:
    owner = app(sqlite_session)
    draft = workflow(sqlite_session, owner, [llm()])
    draft.graph = graph
    plan = collect(sqlite_session, owner)
    assert plan.reasons
    assert plan.reasons[0].type == "workflow"


def dataset(session: Session, *, external: bool = False) -> Dataset:
    row = Dataset(
        tenant_id=TENANT,
        name="Knowledge",
        created_by=ACTOR,
        provider="external" if external else "vendor",
        indexing_technique="economy",
    )
    session.add(row)
    session.flush()
    return row


def document(session: Session, owner: Dataset, **values: object) -> Document:
    row = Document(
        tenant_id=TENANT,
        dataset_id=owner.id,
        position=1,
        data_source_type="upload_file",
        batch="batch",
        name="Document",
        created_from="web",
        created_by=ACTOR,
        indexing_status="completed",
        **values,
    )
    session.add(row)
    session.flush()
    return row


def knowledge_app(session: Session, dataset_id: str) -> App:
    owner = app(session)
    workflow(
        session,
        owner,
        [
            {
                "id": "knowledge",
                "data": {
                    "type": "knowledge-retrieval",
                    "dataset_ids": [dataset_id],
                    "retrieval_mode": "multiple",
                    "multiple_retrieval_config": {"reranking_enable": False},
                },
            }
        ],
    )
    return owner


@pytest.mark.parametrize("state", ["ready", "disabled", "archived", "indexing", "empty", "foreign_document"])
def test_no_usable_documents_are_empty_retrieval_not_blocking_dependencies(sqlite_session: Session, state: str) -> None:
    row = dataset(sqlite_session)
    if state != "empty":
        doc = document(sqlite_session, row, enabled=state != "disabled", archived=state == "archived")
        if state == "indexing":
            doc.indexing_status = "indexing"
        elif state == "foreign_document":
            doc.tenant_id = str(uuid4())
    sqlite_session.flush()
    plan = collect(sqlite_session, knowledge_app(sqlite_session, row.id))
    assert not plan.reasons


def test_empty_knowledge_does_not_require_an_unused_embedding_model(sqlite_session: Session) -> None:
    row = dataset(sqlite_session)
    row.indexing_technique = IndexTechniqueType.HIGH_QUALITY
    plan = collect(sqlite_session, knowledge_app(sqlite_session, row.id))
    assert not plan.reasons
    assert not plan.dependencies


@pytest.mark.parametrize("retrieval_mode", ["single", "multiple"])
def test_empty_workflow_knowledge_does_not_resolve_unused_planner_or_metadata_models(
    sqlite_session: Session, retrieval_mode: str
) -> None:
    row = dataset(sqlite_session)
    owner = app(sqlite_session)
    workflow(
        sqlite_session,
        owner,
        [
            {
                "id": "knowledge",
                "data": {
                    "type": "knowledge-retrieval",
                    "dataset_ids": [row.id],
                    "retrieval_mode": retrieval_mode,
                    "single_retrieval_config": {"model": MODEL},
                    "multiple_retrieval_config": {"reranking_enable": False},
                    "metadata_filtering_mode": "automatic",
                    "metadata_model_config": MODEL,
                },
            }
        ],
    )
    plan = collect(sqlite_session, owner)
    assert not plan.reasons
    assert not plan.dependencies


def test_retrieval_reranks_only_when_multiple_datasets_are_usable(sqlite_session: Session) -> None:
    ready, empty = dataset(sqlite_session), dataset(sqlite_session)
    document(sqlite_session, ready)
    owner = app(sqlite_session)
    workflow(
        sqlite_session,
        owner,
        [
            {
                "id": "knowledge",
                "data": {
                    "type": "knowledge-retrieval",
                    "dataset_ids": [ready.id, empty.id],
                    "retrieval_mode": "multiple",
                    "multiple_retrieval_config": {"reranking_enable": True},
                },
            }
        ],
    )
    plan = collect(sqlite_session, owner)
    assert not plan.reasons
    assert not plan.dependencies


def test_usable_high_quality_knowledge_collects_embedding_and_reranking_models(sqlite_session: Session) -> None:
    row = dataset(sqlite_session)
    row.indexing_technique = IndexTechniqueType.HIGH_QUALITY
    row.embedding_model_provider = MODEL["provider"]
    row.embedding_model = "embedding"
    row.retrieval_model = {
        "search_method": "semantic_search",
        "reranking_enable": True,
        "reranking_model": {"reranking_provider_name": MODEL["provider"], "reranking_model_name": "reranker"},
    }
    document(sqlite_session, row)
    plan = collect(sqlite_session, knowledge_app(sqlite_session, row.id))
    assert not plan.reasons
    assert plan.dependencies == (
        AppModelDependency(MODEL["provider"], "embedding", "text-embedding", row.id),
        AppModelDependency(MODEL["provider"], "reranker", "rerank", row.id),
    )


def test_knowledge_reference_cannot_read_another_tenants_dependencies(sqlite_session: Session) -> None:
    row = dataset(sqlite_session)
    row.tenant_id = str(uuid4())
    row.embedding_model_provider = "private-provider"
    sqlite_session.flush()
    plan = collect(sqlite_session, knowledge_app(sqlite_session, row.id))
    assert [r.reason for r in plan.reasons] == ["missing"]
    assert not plan.dependencies
    assert "private-provider" not in repr(plan)


@pytest.mark.parametrize(
    "case",
    [
        "valid",
        "no_auth",
        "foreign_api",
        "missing_binding",
        "missing_settings",
        "invalid_settings",
        "missing_endpoint",
        "empty_knowledge_id",
    ],
)
def test_external_knowledge_checks_binding_instead_of_requiring_local_documents(
    sqlite_session: Session, case: str
) -> None:
    row = dataset(sqlite_session, external=True)
    settings = {
        "missing_settings": None,
        "invalid_settings": "[]",
        "missing_endpoint": '{"api_key":"secret"}',
        "no_auth": '{"endpoint":"https://example.com"}',
    }.get(case, '{"endpoint":"https://example.com","api_key":"secret"}')
    api = ExternalKnowledgeApis(
        tenant_id=str(uuid4()) if case == "foreign_api" else TENANT,
        name="External",
        description="",
        settings=settings,
        created_by=ACTOR,
        updated_by=ACTOR,
    )
    sqlite_session.add(api)
    sqlite_session.flush()
    if case != "missing_binding":
        sqlite_session.add(
            ExternalKnowledgeBindings(
                tenant_id=TENANT,
                dataset_id=row.id,
                external_knowledge_api_id=api.id,
                external_knowledge_id="" if case == "empty_knowledge_id" else "external-id",
                created_by=ACTOR,
            )
        )
        sqlite_session.flush()
    plan = collect(sqlite_session, knowledge_app(sqlite_session, row.id))
    expected: list[str] = (
        []
        if case in {"valid", "no_auth"}
        else ["missing"]
        if case in {"foreign_api", "missing_binding"}
        else ["invalid-configuration"]
    )
    assert [r.reason for r in plan.reasons] == expected
    assert "secret" not in repr(plan)


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.COMPLETION, AppMode.AGENT_CHAT])
def test_plain_legacy_app_does_not_depend_on_default_reranking_or_disabled_agent_tools(
    sqlite_session: Session, mode: AppMode
) -> None:
    owner = app(sqlite_session, mode)
    config = AppModelConfig(
        app_id=owner.id,
        model=json.dumps(MODEL),
        agent_mode=json.dumps({"enabled": False, "tools": [{"provider_type": "api", "provider_id": str(uuid4())}]}),
    )
    sqlite_session.add(config)
    sqlite_session.flush()
    owner.app_model_config_id = config.id
    plan = collect(sqlite_session, owner)
    assert not plan.reasons
    assert len(plan.dependencies) == 1


def tool_app(session: Session, provider_type: str, provider_id: str, name: str = "lookup", **values: object) -> App:
    owner = app(session)
    workflow(
        session,
        owner,
        [
            {
                "id": "tool",
                "data": {
                    "type": "tool",
                    "provider_type": provider_type,
                    "provider_id": provider_id,
                    "tool_name": name,
                    **values,
                },
            }
        ],
    )
    return owner


@pytest.mark.parametrize(
    "reference",
    [
        "id",
        "name",
        "unknown_tool",
        "foreign_tenant",
        "missing_auth",
        "missing_key",
        "empty_key",
        "invalid_key",
        "query_missing_key",
        "valid_key",
        "valid_legacy_key",
    ],
)
def test_api_tool_requires_runtime_provider_id_operation_id_and_auth(sqlite_session: Session, reference: str) -> None:
    credential_cases: dict[str, dict[str, object]] = {
        "missing_auth": {},
        "missing_key": {"auth_type": "api_key_header"},
        "empty_key": {"auth_type": "api_key_header", "api_key_value": ""},
        "invalid_key": {"auth_type": "api_key_header", "api_key_value": 7},
        "query_missing_key": {"auth_type": "api_key_query"},
        "valid_key": {"auth_type": "api_key_query", "api_key_value": "encrypted-secret"},
        "valid_legacy_key": {"auth_type": "api_key", "api_key_value": "encrypted-secret"},
    }
    credentials = credential_cases.get(reference, {"auth_type": "none"})
    provider = ApiToolProvider(
        tenant_id=str(uuid4()) if reference == "foreign_tenant" else TENANT,
        user_id=ACTOR,
        name="api-example",
        icon="{}",
        schema="{}",
        schema_type_str=ApiProviderSchemaType.OPENAPI,
        description="",
        tools_str=json.dumps(
            [
                {
                    "server_url": "https://example.com",
                    "method": "get",
                    "operation_id": "lookup",
                    "summary": "",
                    "parameters": [],
                    "author": "Example",
                    "openapi": {},
                }
            ]
        ),
        credentials_str=json.dumps(credentials),
    )
    sqlite_session.add(provider)
    sqlite_session.flush()
    owner = tool_app(
        sqlite_session,
        "api",
        provider.name if reference == "name" else provider.id,
        name="deleted" if reference == "unknown_tool" else "lookup",
    )
    plan = collect(sqlite_session, owner)
    expected: list[str] = (
        ["missing"]
        if reference in {"name", "unknown_tool", "foreign_tenant"}
        else ["no-configure"]
        if reference in {"missing_auth", "missing_key", "empty_key", "invalid_key", "query_missing_key"}
        else []
    )
    assert [r.reason for r in plan.reasons] == expected
    assert "encrypted-secret" not in repr(plan)


@pytest.mark.parametrize("authed", [True, False])
@pytest.mark.parametrize("reference", ["id", "server", "uuid_server"])
def test_mcp_tool_requires_authorized_provider(sqlite_session: Session, authed: bool, reference: str) -> None:
    provider = MCPToolProvider(
        tenant_id=TENANT,
        user_id=ACTOR,
        name="MCP",
        server_identifier=str(uuid4()) if reference == "uuid_server" else "mcp",
        server_url="encrypted",
        server_url_hash="hash",
        icon=None,
        authed=authed,
        tools='[{"name":"lookup"}]',
    )
    sqlite_session.add(provider)
    sqlite_session.flush()
    plan = collect(
        sqlite_session,
        tool_app(sqlite_session, "mcp", provider.id if reference == "id" else provider.server_identifier),
    )
    assert [r.reason for r in plan.reasons] == ([] if authed else ["no-configure"])


def test_workflow_tool_follows_pinned_version_and_its_dependencies(sqlite_session: Session) -> None:
    target = app(sqlite_session)
    workflow(sqlite_session, target, [llm("pinned")], version="v1")
    current = workflow(sqlite_session, target, [llm("current")], version="v2")
    target.workflow_id = current.id
    provider = WorkflowToolProvider(
        tenant_id=TENANT,
        user_id=ACTOR,
        name="lookup",
        label="Lookup",
        icon="{}",
        description="",
        app_id=target.id,
        version="v1",
    )
    sqlite_session.add(provider)
    sqlite_session.flush()
    plan = collect(sqlite_session, tool_app(sqlite_session, "workflow", provider.id))
    assert not plan.reasons
    assert [d.model for d in plan.dependencies if isinstance(d, AppModelDependency)] == ["pinned"]


def test_builtin_credential_metadata_is_scoped_to_provider_and_tenant(sqlite_session: Session) -> None:
    credential = BuiltinToolProvider(
        name="Credential",
        tenant_id=TENANT,
        user_id=ACTOR,
        provider="langgenius/search/search",
        encrypted_credentials='{"api_key":"encrypted-secret"}',
    )
    sqlite_session.add(credential)
    sqlite_session.flush()
    owner = tool_app(
        sqlite_session,
        "builtin",
        credential.provider,
        credential_id=credential.id,
    )
    plan = collect(sqlite_session, owner)
    assert isinstance(plan.dependencies[0], AppToolDependency)
    assert plan.dependencies[0].credential_exists is True
    credential.tenant_id = str(uuid4())
    sqlite_session.flush()
    plan = collect(sqlite_session, owner)
    assert isinstance(plan.dependencies[0], AppToolDependency)
    assert plan.dependencies[0].credential_exists is False
    assert "encrypted-secret" not in repr(plan)


@pytest.mark.parametrize("published", [True, False])
@pytest.mark.parametrize("draft_state", ["configured", "empty", "absent"])
def test_agent_app_checks_editable_definition_not_publication_state(
    sqlite_session: Session, published: bool, draft_state: str
) -> None:
    owner = app(sqlite_session, AppMode.AGENT)
    agent = Agent(
        tenant_id=TENANT,
        name="Agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
        status=AgentStatus.ACTIVE,
        app_id=owner.id,
        backing_app_id=owner.id,
    )
    sqlite_session.add(agent)
    sqlite_session.flush()
    soul = AgentSoulConfig.model_validate(
        {
            "model": {"plugin_id": "langgenius/openai", "model_provider": MODEL["provider"], "model": "published"},
        }
    )
    snapshot = AgentConfigSnapshot(
        tenant_id=TENANT,
        agent_id=agent.id,
        version=1,
        config_snapshot=soul,
    )
    sqlite_session.add(snapshot)
    sqlite_session.flush()
    agent.active_config_snapshot_id = snapshot.id
    agent.active_config_is_published = published
    sqlite_session.add(
        AgentConfigRevision(
            tenant_id=TENANT,
            agent_id=agent.id,
            current_snapshot_id=snapshot.id,
            revision=1,
            operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
        )
    )
    if draft_state != "absent":
        sqlite_session.add(
            AgentConfigDraft(
                tenant_id=TENANT,
                agent_id=agent.id,
                draft_type=AgentConfigDraftType.DRAFT,
                config_snapshot=AgentSoulConfig.model_validate(
                    {"model": {"plugin_id": "langgenius/openai", "model_provider": MODEL["provider"], "model": "draft"}}
                )
                if draft_state == "configured"
                else AgentSoulConfig(),
            )
        )
    sqlite_session.flush()
    plan = collect(sqlite_session, owner)
    assert plan.source == "draft"
    assert bool(plan.reasons) is (draft_state == "empty")
    assert [d.model for d in plan.dependencies if isinstance(d, AppModelDependency)] == (
        [] if draft_state == "empty" else ["published" if draft_state == "absent" else "draft"]
    )


def test_nonlocal_workflow_dependencies_are_detached(sqlite_session: Session) -> None:
    owner = app(sqlite_session)
    workflow(
        sqlite_session,
        owner,
        [
            {
                "id": "trigger",
                "data": {"type": "trigger-plugin", "plugin_id": "langgenius/schedule"},
            }
        ],
    )
    plan = collect(sqlite_session, owner)
    assert plan.dependencies == (AppPluginDependency("langgenius/schedule", "trigger"),)


def test_recursive_workflow_tools_visit_dependencies_without_treating_recursion_itself_as_failure(
    sqlite_session: Session,
) -> None:
    owner = app(sqlite_session)
    published = workflow(sqlite_session, owner, [llm()], version="v1")
    owner.workflow_id = published.id
    provider = WorkflowToolProvider(
        tenant_id=TENANT,
        user_id=ACTOR,
        name="lookup",
        label="Lookup",
        icon="{}",
        description="",
        app_id=owner.id,
        version="v1",
    )
    sqlite_session.add(provider)
    sqlite_session.flush()
    published.graph = json.dumps(
        {
            "nodes": [
                {
                    "id": "recursive",
                    "data": {
                        "type": "tool",
                        "provider_type": "workflow",
                        "provider_id": provider.id,
                        "tool_name": "lookup",
                    },
                },
                llm("recursive-model"),
            ],
            "edges": [],
        }
    )
    workflow(sqlite_session, owner, json.loads(published.graph)["nodes"])
    plan = collect(sqlite_session, owner)
    assert not plan.reasons
    assert plan.dependencies == (AppModelDependency(MODEL["provider"], "recursive-model", "llm", "recursive-model"),)


@pytest.mark.parametrize("case", ["valid", "promoted_inline", "wrong_version", "foreign_agent", "foreign_snapshot"])
def test_workflow_agent_binding_uses_full_owner_and_version_chain(sqlite_session: Session, case: str) -> None:
    owner = app(sqlite_session)
    draft = workflow(
        sqlite_session,
        owner,
        [
            {
                "id": "agent-node",
                "data": {
                    "type": "agent",
                    "agent_node_kind": "dify_agent",
                },
            }
        ],
    )
    agent = Agent(
        tenant_id=str(uuid4()) if case == "foreign_agent" else TENANT,
        name="Inline",
        scope=AgentScope.ROSTER if case == "promoted_inline" else AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
        app_id=owner.id,
        workflow_id=draft.id,
        workflow_node_id="agent-node",
    )
    sqlite_session.add(agent)
    sqlite_session.flush()
    soul = AgentSoulConfig.model_validate(
        {
            "model": {
                "plugin_id": "langgenius/openai",
                "model_provider": MODEL["provider"],
                "model": "agent-model",
            }
        }
    )
    snapshot = AgentConfigSnapshot(
        tenant_id=TENANT,
        agent_id=str(uuid4()) if case == "foreign_snapshot" else agent.id,
        version=1,
        config_snapshot=soul,
    )
    sqlite_session.add(snapshot)
    sqlite_session.flush()
    sqlite_session.add(
        WorkflowAgentNodeBinding(
            tenant_id=TENANT,
            app_id=owner.id,
            workflow_id=draft.id,
            workflow_version="old" if case == "wrong_version" else draft.version,
            node_id="agent-node",
            binding_type=WorkflowAgentBindingType.INLINE_AGENT,
            agent_id=agent.id,
            current_snapshot_id=snapshot.id,
            node_job_config=WorkflowNodeJobConfig(),
        )
    )
    sqlite_session.flush()
    plan = collect(sqlite_session, owner)
    if case in {"valid", "promoted_inline"}:
        assert not plan.reasons
        assert [d.model for d in plan.dependencies if isinstance(d, AppModelDependency)] == ["agent-model"]
    else:
        assert len(plan.reasons) == 1
        assert plan.reasons[0].type == "agent"
        assert not plan.dependencies


def test_legacy_agent_parameter_models_and_tools_are_dependencies(sqlite_session: Session) -> None:
    owner = app(sqlite_session)
    workflow(
        sqlite_session,
        owner,
        [
            {
                "id": "agent",
                "data": {
                    "type": "agent",
                    "agent_strategy_provider_name": "langgenius/agent/strategy",
                    "agent_parameters": {
                        "model": {"type": "constant", "value": {"provider": MODEL["provider"], "model": "agent-model"}},
                        "tools": {
                            "type": "constant",
                            "value": [
                                {
                                    "type": "builtin",
                                    "provider_name": "langgenius/search/search",
                                    "tool_name": "lookup",
                                    "enabled": True,
                                },
                                {
                                    "type": "builtin",
                                    "provider_name": "removed",
                                    "tool_name": "disabled",
                                    "enabled": False,
                                },
                            ],
                        },
                    },
                },
            }
        ],
    )
    plan = collect(sqlite_session, owner)
    assert not plan.reasons
    assert AppModelDependency(MODEL["provider"], "agent-model", "llm", "agent") in plan.dependencies
    tools = [d for d in plan.dependencies if isinstance(d, AppToolDependency)]
    assert len(tools) == 1
    assert tools[0].provider_id == "langgenius/search/search"


def test_request_cache_does_not_accept_snapshot_for_another_agent(sqlite_session: Session) -> None:
    agents = [
        Agent(tenant_id=TENANT, name=f"Inline {index}", scope=AgentScope.WORKFLOW_ONLY, source=AgentSource.WORKFLOW)
        for index in range(2)
    ]
    sqlite_session.add_all(agents)
    sqlite_session.flush()
    snapshot = AgentConfigSnapshot(
        tenant_id=TENANT,
        agent_id=agents[0].id,
        version=1,
        config_snapshot=AgentSoulConfig.model_validate(
            {"model": {"plugin_id": "langgenius/openai", "model_provider": MODEL["provider"], "model": "owned"}}
        ),
    )
    sqlite_session.add(snapshot)
    sqlite_session.flush()
    owners = []
    for agent in agents:
        owner = app(sqlite_session)
        draft = workflow(
            sqlite_session,
            owner,
            [{"id": "agent-node", "data": {"type": "agent", "agent_node_kind": "dify_agent"}}],
        )
        agent.app_id = owner.id
        agent.workflow_id = draft.id
        agent.workflow_node_id = "agent-node"
        sqlite_session.add(
            WorkflowAgentNodeBinding(
                tenant_id=TENANT,
                app_id=owner.id,
                workflow_id=draft.id,
                workflow_version=draft.version,
                node_id="agent-node",
                binding_type=WorkflowAgentBindingType.INLINE_AGENT,
                agent_id=agent.id,
                current_snapshot_id=snapshot.id,
                node_job_config=WorkflowNodeJobConfig(),
            )
        )
        owners.append(owner)
    sqlite_session.flush()
    plans = AppAvailabilityRepository(session=sqlite_session, tenant_id=TENANT).collect_many(owners)
    assert not plans[owners[0].id].reasons
    assert plans[owners[0].id].dependencies == (AppModelDependency(MODEL["provider"], "owned", "llm", agents[0].id),)
    assert [r.reason for r in plans[owners[1].id].reasons] == ["invalid-configuration"]
    assert not plans[owners[1].id].dependencies
