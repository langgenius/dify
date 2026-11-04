import json
import uuid
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime
from io import BytesIO
from typing import Final, Protocol, cast

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import BadRequest

from constants.oauth_bearer import TokenType
from controllers.openapi import app_workflow
from controllers.openapi._errors import (
    DraftNotFound,
    EnvVariableNotFound,
    RunNotFound,
    SecretMaskNotSecret,
    SecretMaskUnknownId,
    VersionNotFound,
)
from controllers.openapi._hints import cursor_after, next_page_hint
from controllers.openapi._models import (
    AdvancedChatNodeRunPayload,
    EnvVariableSetPayload,
    NodeRunPayload,
    PublishPayload,
    PublishResponse,
    RestoreResponse,
    RunListQuery,
    RunListResponse,
    VersionListQuery,
    VersionListResponse,
)
from controllers.openapi._upload import UploadParts, file_fields
from controllers.openapi.app_workflow import (
    AppEnvItemApi,
    AppPublishApi,
    AppRunListApi,
    AppRunNodeListApi,
    AppVersionListApi,
    AppVersionRestoreApi,
    env_variable_rows,
    run_draft_node,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import AccountSubject
from core.helper import encrypter
from core.workflow.node_factory import resolve_workflow_node_class
from core.workflow.workflow_entry import WorkflowEntry
from extensions.ext_application_services import ApplicationServices
from graphon.entities.graph_config import NodeConfigDictAdapter
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import VariablePool
from graphon.variables import SecretVariable, StringVariable, VariableBase
from libs.oauth_bearer import AuthContext
from models.account import Account, Tenant
from models.enums import AppStatus, CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import App, AppMode, IconType
from models.workflow import Workflow, WorkflowRun, WorkflowType
from services.workflow.graph_diff import draft_token
from services.workflow_service import WorkflowService

WORKSPACE_ID = "00000000-0000-4000-8000-000000000001"
APP_ID = "00000000-0000-4000-8000-000000000002"
ACCOUNT_ID = "00000000-0000-4000-8000-000000000003"
VERSION_ID = "00000000-0000-4000-8000-000000000004"


class _EndpointView(Protocol):
    """Structural stand-in for a `view` carrying the attributes `@endpoint` attaches."""

    __handler__: Callable[..., object]


@pytest.fixture(autouse=True)
def _identity_secret_encryption(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep secret variables readable without the workspace key provider."""
    monkeypatch.setattr(encrypter, "encrypt_token", lambda **kwargs: kwargs["token"])
    monkeypatch.setattr(encrypter, "decrypt_token", lambda **kwargs: kwargs["token"])


def _app_context(session: Session, **view_args: str) -> Context:
    auth = AuthContext(
        token_type=TokenType.OAUTH_ACCOUNT,
        subject_email="tester@example.com",
        subject_issuer="dify:account",
        account_id=uuid.UUID(ACCOUNT_ID),
        client_id="difyctl",
        token_id=uuid.uuid4(),
        expires_at=None,
    )
    ctx = Context(AccountSubject(auth), session, {"app_id": APP_ID, **view_args})
    ctx._workspace = Tenant(name="w")
    ctx._workspace.id = WORKSPACE_ID
    ctx._app = App(
        id=APP_ID,
        tenant_id=WORKSPACE_ID,
        name="a",
        description="",
        mode=AppMode.WORKFLOW,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#FFFFFF",
        status=AppStatus.NORMAL,
        enable_site=True,
        enable_api=True,
    )
    session.add(ctx._app)
    session.commit()
    account = Account(name="tester", email="tester@example.com")
    account.id = ACCOUNT_ID
    ctx._caller = account
    return ctx


def _workflow_service(monkeypatch: pytest.MonkeyPatch, session_factory: sessionmaker[Session]) -> WorkflowService:
    """`WorkflowService()` builds its sessions from db.engine, which the bare Flask app these tests run
    under does not have; hand the handlers the real service over the test database instead."""
    service = WorkflowService(session_factory)
    monkeypatch.setattr(app_workflow, "WorkflowService", lambda: service)
    return service


def _workflow(
    *, version: str = Workflow.VERSION_DRAFT, graph: str = "{}", environment_variables: Sequence[VariableBase] = ()
) -> Workflow:
    return Workflow.new(
        tenant_id=WORKSPACE_ID,
        app_id=APP_ID,
        type=WorkflowType.WORKFLOW,
        version=version,
        graph=graph,
        features="{}",
        created_by=ACCOUNT_ID,
        environment_variables=environment_variables,
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def _add_draft(session: Session, *, graph: str = "{}", environment_variables: Sequence[VariableBase] = ()) -> Workflow:
    draft = _workflow(graph=graph, environment_variables=environment_variables)
    session.add(draft)
    session.commit()
    return draft


def _env(draft: Workflow) -> list[tuple[str, object, type]]:
    return [(variable.id, variable.value, type(variable)) for variable in draft.environment_variables]


def test_env_variable_view_masks_only_secrets_that_have_a_value() -> None:
    """An empty secret reads back empty, not masked: masking it would claim a value that is not there."""
    secret = SecretVariable(id="s", name="KEY", value="plain", selector=["env", "KEY"])
    empty_secret = SecretVariable(id="e", name="BLANK", value="", selector=["env", "BLANK"])
    plain = StringVariable(id="p", name="URL", value="https://x", selector=["env", "URL"])
    rows = env_variable_rows([secret, empty_secret, plain])
    assert [row.value for row in rows] == [encrypter.full_mask_token(), "", "https://x"]


def test_run_list_hints_the_next_cursor() -> None:
    [hint] = next_page_hint(
        op="get.run",
        path_args={"app_id": "app-1"},
        query=RunListQuery(limit=1),
        page=cursor_after(last_id="run-1", has_more=True),
    )
    assert hint.input == {"app_id": "app-1", "limit": 1, "triggered_from": "debugging", "last_id": "run-1"}


def test_set_env_rejects_mask_for_unknown_id(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Sending the mask for an id that is not a stored secret must not encrypt the
    literal mask into the draft (the bug: it silently succeeded, storing `[__HIDDEN__]`)."""
    _workflow_service(monkeypatch, sqlite_session_factory)
    ctx = _app_context(sqlite_session, env_id="unknown-id")
    draft = _add_draft(sqlite_session)

    body = EnvVariableSetPayload(name="KEY", value_type="secret", value=encrypter.full_mask_token())
    api = AppEnvItemApi()
    with app.test_request_context("/openapi/v1/apps/app-1/env/unknown-id", method="PUT"):
        with pytest.raises(SecretMaskUnknownId):
            cast(_EndpointView, api.put).__handler__(api, ctx, "app-1", "unknown-id", body=body)

    assert _env(draft) == []


def test_set_env_accepts_mask_for_a_stored_secret(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """The same mask for an id that *is* a stored secret keeps the existing flow working."""
    stored = SecretVariable(id="s-1", name="KEY", value="plain", selector=["env", "KEY"])
    _workflow_service(monkeypatch, sqlite_session_factory)
    ctx = _app_context(sqlite_session, env_id="s-1")
    draft = _add_draft(sqlite_session, environment_variables=[stored])

    body = EnvVariableSetPayload(name="KEY", value_type="secret", value=encrypter.full_mask_token())
    api = AppEnvItemApi()
    with app.test_request_context("/openapi/v1/apps/app-1/env/s-1", method="PUT"):
        cast(_EndpointView, api.put).__handler__(api, ctx, "app-1", "s-1", body=body)

    assert _env(draft) == [("s-1", "plain", SecretVariable)]
    assert draft.updated_by == ACCOUNT_ID


def test_set_env_rejects_the_mask_as_a_plain_value(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Re-typing a stored secret as a string while sending the mask would store the mask text
    and destroy the secret."""
    stored = SecretVariable(id="s-1", name="KEY", value="plain", selector=["env", "KEY"])
    _workflow_service(monkeypatch, sqlite_session_factory)
    ctx = _app_context(sqlite_session, env_id="s-1")
    draft = _add_draft(sqlite_session, environment_variables=[stored])

    body = EnvVariableSetPayload(name="KEY", value_type="string", value=encrypter.full_mask_token())
    api = AppEnvItemApi()
    with app.test_request_context("/openapi/v1/apps/app-1/env/s-1", method="PUT"):
        with pytest.raises(SecretMaskNotSecret):
            cast(_EndpointView, api.put).__handler__(api, ctx, "app-1", "s-1", body=body)

    assert _env(draft) == [("s-1", "plain", SecretVariable)]


def test_set_env_without_a_draft_is_not_found(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _workflow_service(monkeypatch, sqlite_session_factory)
    ctx = _app_context(sqlite_session, env_id="e-1")

    body = EnvVariableSetPayload(name="KEY", value_type="string", value="v")
    api = AppEnvItemApi()
    with app.test_request_context("/openapi/v1/apps/app-1/env/e-1", method="PUT"):
        with pytest.raises(DraftNotFound):
            cast(_EndpointView, api.put).__handler__(api, ctx, "app-1", "e-1", body=body)

    assert sqlite_session.scalars(select(Workflow)).all() == []


def test_delete_env_without_a_draft_is_not_found(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _workflow_service(monkeypatch, sqlite_session_factory)
    ctx = _app_context(sqlite_session, env_id="e-1")

    api = AppEnvItemApi()
    with app.test_request_context("/openapi/v1/apps/app-1/env/e-1", method="DELETE"):
        with pytest.raises(DraftNotFound):
            cast(_EndpointView, api.delete).__handler__(api, ctx, "app-1", "e-1")

    assert sqlite_session.scalars(select(Workflow)).all() == []


def test_delete_env_with_an_unknown_id_is_not_found(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """An unknown id must not report success while deleting nothing."""
    stored = StringVariable(id="e-1", name="KEY", value="v", selector=["env", "KEY"])
    _workflow_service(monkeypatch, sqlite_session_factory)
    ctx = _app_context(sqlite_session, env_id="typo")
    draft = _add_draft(sqlite_session, environment_variables=[stored])

    api = AppEnvItemApi()
    with app.test_request_context("/openapi/v1/apps/app-1/env/typo", method="DELETE"):
        with pytest.raises(EnvVariableNotFound):
            cast(_EndpointView, api.delete).__handler__(api, ctx, "app-1", "typo")

    assert _env(draft) == [("e-1", "v", StringVariable)]


def test_delete_env_removes_a_stored_variable(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    stored = StringVariable(id="e-1", name="KEY", value="v", selector=["env", "KEY"])
    kept = StringVariable(id="e-2", name="URL", value="https://x", selector=["env", "URL"])
    _workflow_service(monkeypatch, sqlite_session_factory)
    ctx = _app_context(sqlite_session, env_id="e-1")
    draft = _add_draft(sqlite_session, environment_variables=[stored, kept])

    api = AppEnvItemApi()
    with app.test_request_context("/openapi/v1/apps/app-1/env/e-1", method="DELETE"):
        cast(_EndpointView, api.delete).__handler__(api, ctx, "app-1", "e-1")

    assert _env(draft) == [("e-2", "https://x", StringVariable)]


def test_set_env_payload_rejects_a_value_type_the_console_does_not_allow() -> None:
    with pytest.raises(ValidationError):
        EnvVariableSetPayload(name="KEY", value_type="boolean", value=True)


def test_restore_rejects_a_garbage_version_id(app: Flask, sqlite_session: Session) -> None:
    api = AppVersionRestoreApi()
    ctx = _app_context(sqlite_session, version_id="not-a-uuid")
    with app.test_request_context("/openapi/v1/apps/app-1/versions/not-a-uuid:restore", method="POST"):
        with pytest.raises(VersionNotFound):
            cast(_EndpointView, api.post).__handler__(api, ctx, "app-1", "not-a-uuid")


def test_version_list_excludes_the_draft(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _workflow_service(monkeypatch, sqlite_session_factory)
    ctx = _app_context(sqlite_session)
    _add_draft(sqlite_session)
    published = _workflow(version=Workflow.version_from_datetime(datetime(2026, 10, 1, 12, 0, 0)))
    sqlite_session.add(published)
    sqlite_session.commit()
    ctx.app.workflow_id = published.id

    api = AppVersionListApi()
    with app.test_request_context("/openapi/v1/apps/app-1/versions"):
        response = cast(_EndpointView, api.get).__handler__(api, ctx, "app-1", query=VersionListQuery())

    assert [row.id for row in cast(VersionListResponse, response).data] == [published.id]


def test_restore_returns_the_hash_an_import_checks(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    service = _workflow_service(monkeypatch, sqlite_session_factory)
    restored = _workflow(graph=_branch_skipping_graph())
    monkeypatch.setattr(service, "restore_published_workflow_to_draft", lambda **_kwargs: restored)
    version_id = "11111111-1111-4111-8111-111111111111"
    ctx = _app_context(sqlite_session, version_id=version_id)

    api = AppVersionRestoreApi()
    with app.test_request_context(f"/openapi/v1/apps/app-1/versions/{version_id}:restore", method="POST"):
        response = cast(_EndpointView, api.post).__handler__(api, ctx, "app-1", version_id)

    assert cast(RestoreResponse, response).draft_hash == draft_token(restored)


def test_run_node_list_is_not_found_for_a_run_of_another_app(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    account_application_services: ApplicationServices,
) -> None:
    """Match describe: an unknown run is a 404, not an empty step list."""
    monkeypatch.setattr(app_workflow, "application_services", lambda: account_application_services)
    step_reads: list[object] = []
    monkeypatch.setattr(
        account_application_services.workflow_runs,
        "get_workflow_run_node_executions",
        lambda *args, **kwargs: step_reads.append((args, kwargs)),
    )
    run_id = "11111111-1111-4111-8111-111111111111"
    ctx = _app_context(sqlite_session, run_id=run_id)

    api = AppRunNodeListApi()
    with app.test_request_context(f"/openapi/v1/apps/app-1/runs/{run_id}/nodes"):
        with pytest.raises(RunNotFound):
            cast(_EndpointView, api.get).__handler__(api, ctx, "app-1", run_id)

    assert step_reads == []


@pytest.mark.parametrize("payload_cls", [NodeRunPayload, AdvancedChatNodeRunPayload])
def test_node_run_payload_accepts_files_and_forbids_attachments(payload_cls: type[NodeRunPayload]) -> None:
    assert payload_cls.model_validate({"inputs": {}, "files": None}).files is None
    with pytest.raises(ValidationError):
        payload_cls.model_validate({"attachments": []})


_UPSTREAM: Final = ["search", "text"]


def _code_node(node_id: str) -> dict[str, object]:
    return {
        "id": node_id,
        "data": {
            "type": "code",
            "title": "Shorten",
            "code_language": "python3",
            "code": "def main(results):\n    return {'short': results}",
            "variables": [{"variable": "results", "value_selector": _UPSTREAM}],
            "outputs": {"short": {"type": "string"}},
        },
    }


_TEMPLATE_NODE: Final[Mapping[str, object]] = {
    "id": "digest",
    "data": {
        "type": "template-transform",
        "title": "Digest",
        "template": "{{ headlines }}",
        "variables": [{"variable": "headlines", "value_selector": _UPSTREAM}],
    },
}
_TOOL_NODE: Final[Mapping[str, object]] = {
    "id": "now",
    "data": {
        "type": "tool",
        "title": "Now",
        "provider_id": "time",
        "provider_type": "builtin",
        "provider_name": "time",
        "tool_name": "current_time",
        "tool_label": "Current Time",
        "tool_configurations": {},
        "tool_parameters": {"query": {"type": "mixed", "value": "news at {{#search.text#}}"}},
    },
}


def _code_node_graph(node_id: str) -> str:
    return _graph(_code_node(node_id))


def _graph(node: Mapping[str, object]) -> str:
    return json.dumps({"nodes": [node], "edges": []})


def _run_inputs(
    monkeypatch: pytest.MonkeyPatch,
    session: Session,
    session_factory: sessionmaker[Session],
    node: Mapping[str, object],
    inputs: dict[str, object],
) -> Mapping[str, object]:
    """The user inputs the node test hands the single-step run."""
    service = _workflow_service(monkeypatch, session_factory)
    ctx = _app_context(session)
    _add_draft(session, graph=_graph(node))
    handed: list[Mapping[str, object]] = []

    def run_draft_workflow_node(*, user_inputs: Mapping[str, object], **_kwargs: object) -> None:
        handed.append(user_inputs)

    monkeypatch.setattr(service, "run_draft_workflow_node", run_draft_workflow_node)
    monkeypatch.setattr(app_workflow, "node_execution_response_source", lambda *_args, **_kwargs: {"id": "e-1"})

    run_draft_node(ctx, str(node["id"]), inputs=inputs, query="")

    [user_inputs] = handed
    return user_inputs


def _read_by_the_run(node: Mapping[str, object], user_inputs: Mapping[str, object]) -> VariablePool:
    """The pool the single-step run fills from `user_inputs`, through the node's own variable mapping."""
    config = NodeConfigDictAdapter.validate_python(node)
    node_cls = resolve_workflow_node_class(node_type=config["data"].type, node_version=config["data"].version)
    mapping = node_cls.extract_variable_selector_to_variable_mapping(
        graph_config=json.loads(_graph(node)), config=config
    )
    pool = VariablePool()
    WorkflowEntry.mapping_user_inputs_to_variable_pool(
        variable_mapping=mapping, user_inputs=user_inputs, variable_pool=pool, tenant_id=WORKSPACE_ID
    )
    return pool


@pytest.mark.parametrize("node", [_code_node("shorten"), _TEMPLATE_NODE, _TOOL_NODE], ids=["code", "template", "tool"])
@pytest.mark.parametrize("key", ["#search.text#", "search.text"])
def test_a_node_test_takes_an_upstream_reference_with_or_without_hashes(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    node: Mapping[str, object],
    key: str,
) -> None:
    user_inputs = _run_inputs(monkeypatch, sqlite_session, sqlite_session_factory, node, {key: "AI news"})

    variable = _read_by_the_run(node, user_inputs).get(_UPSTREAM)
    assert variable is not None
    assert variable.value == "AI news"


@pytest.mark.parametrize(
    ("node", "inputs"),
    [
        pytest.param(_code_node("shorten"), {"results": "AI news"}, id="code-variable"),
        pytest.param(_code_node("shorten"), {"shorten.results": "AI news"}, id="code-node-variable"),
        pytest.param(_TOOL_NODE, {"#search.text#": "AI news"}, id="tool-reference"),
    ],
)
def test_a_node_test_hands_the_keys_the_run_already_reads_unchanged(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    node: Mapping[str, object],
    inputs: dict[str, object],
) -> None:
    user_inputs = _run_inputs(monkeypatch, sqlite_session, sqlite_session_factory, node, inputs)

    assert {key: user_inputs[key] for key in inputs} == inputs
    variable = _read_by_the_run(node, user_inputs).get(_UPSTREAM)
    assert variable is not None
    assert variable.value == "AI news"


def test_a_node_test_with_an_unknown_key_still_names_the_missing_variable(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    node = _code_node("shorten")

    user_inputs = _run_inputs(monkeypatch, sqlite_session, sqlite_session_factory, node, {"#other.text#": "x"})

    assert user_inputs == {"#other.text#": "x"}
    with pytest.raises(ValueError, match=r"^Variable key shorten\.results not found in user inputs\.$"):
        _read_by_the_run(node, user_inputs)


def _upload_part() -> FileStorage:
    return FileStorage(stream=BytesIO(b"doc"), filename="doc.txt", content_type="text/plain")


def test_run_draft_node_merges_local_files_into_the_inputs(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    service = _workflow_service(monkeypatch, sqlite_session_factory)
    ctx = _app_context(sqlite_session)
    _add_draft(sqlite_session, graph=_code_node_graph("n1"))
    merges: list[tuple[object, ...]] = []

    def merge_files(inputs: object, files: object, caller: object) -> dict[str, object]:
        merges.append((inputs, files, caller))
        return {"x": 1, "doc": {"id": "file-1"}}

    node_runs: list[dict[str, object]] = []
    monkeypatch.setattr(app_workflow, "merge_files", merge_files)
    monkeypatch.setattr(service, "run_draft_workflow_node", lambda **kwargs: node_runs.append(kwargs))
    monkeypatch.setattr(app_workflow, "node_execution_response_source", lambda *_args, **_kwargs: {"id": "e-1"})
    parts: UploadParts = {"doc": _upload_part()}

    run_draft_node(ctx, "n1", inputs={"x": 1}, query="", files=parts)

    assert merges == [({"x": 1}, parts, ctx.caller)]
    assert [run["user_inputs"] for run in node_runs] == [{"x": 1, "doc": {"id": "file-1"}}]


def test_node_run_payloads_take_files_as_multipart_parts() -> None:
    assert file_fields(NodeRunPayload) == {"files"}
    assert file_fields(AdvancedChatNodeRunPayload) == {"files"}


@pytest.mark.parametrize(("with_files", "ends_transaction"), [(True, True), (False, False)])
def test_run_draft_node_ends_the_read_transaction_before_uploading(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    with_files: bool,
    ends_transaction: bool,
) -> None:
    service = _workflow_service(monkeypatch, sqlite_session_factory)
    ctx = _app_context(sqlite_session)
    _add_draft(sqlite_session, graph=_code_node_graph("n1"))
    names: list[str] = []
    monkeypatch.setattr(app_workflow, "end_read_transaction", lambda _session: names.append("end"))

    def merge_files(inputs: dict[str, object], *_args: object) -> dict[str, object]:
        names.append("merge")
        return inputs

    monkeypatch.setattr(app_workflow, "merge_files", merge_files)
    monkeypatch.setattr(service, "run_draft_workflow_node", lambda **_kwargs: None)
    monkeypatch.setattr(app_workflow, "node_execution_response_source", lambda *_args, **_kwargs: {"id": "e-1"})
    files: UploadParts | None = {"doc": _upload_part()} if with_files else None

    run_draft_node(ctx, "n1", inputs={}, query="", files=files)

    assert names == (["end", "merge"] if ends_transaction else ["merge"])


def _branch_skipping_graph() -> str:
    return json.dumps(
        {
            "nodes": [
                {"id": "start", "data": {"type": "start"}},
                {"id": "branch", "data": {"type": "if-else"}},
                {"id": "producer", "data": {"type": "code", "title": "Producer"}},
                {"id": "consumer", "data": {"type": "answer", "title": "Consumer", "answer": "{{#producer.text#}}"}},
            ],
            "edges": [
                {"source": "start", "target": "branch"},
                {"source": "branch", "target": "producer", "sourceHandle": "true"},
                {"source": "branch", "target": "consumer", "sourceHandle": "false"},
            ],
        }
    )


def _published_version(graph: str) -> Workflow:
    version = _workflow(version=Workflow.version_from_datetime(datetime(2026, 10, 1, 12, 0, 0)), graph=graph)
    version.id = VERSION_ID
    version.created_at = datetime(2026, 10, 1, 12, 0, 0)
    return version


@pytest.mark.parametrize("graph", ["{}", "{", ""], ids=["clean", "invalid-json", "empty"])
def test_publish_points_the_app_at_the_new_version(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    graph: str,
) -> None:
    service = _workflow_service(monkeypatch, sqlite_session_factory)
    publishes: list[dict[str, object]] = []

    def publish_workflow(**kwargs: object) -> Workflow:
        publishes.append(kwargs)
        return _published_version(graph)

    monkeypatch.setattr(service, "publish_workflow", publish_workflow)
    ctx = _app_context(sqlite_session)

    api = AppPublishApi()
    with app.test_request_context("/openapi/v1/apps/app-1:publish", method="POST"):
        response = cast(_EndpointView, api.post).__handler__(api, ctx, "app-1", body=PublishPayload(marked_name="v2"))

    stored_app = sqlite_session.get(App, APP_ID)
    assert stored_app is not None
    assert [publish["marked_name"] for publish in publishes] == ["v2"]
    assert (stored_app.workflow_id, stored_app.updated_by) == (VERSION_ID, ACCOUNT_ID)
    assert stored_app.updated_at is not None
    assert cast(PublishResponse, response).version_id == VERSION_ID
    assert cast(PublishResponse, response).warning is None


def test_publish_warns_about_references_to_a_skipped_branch(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    service = _workflow_service(monkeypatch, sqlite_session_factory)
    monkeypatch.setattr(service, "publish_workflow", lambda **_kwargs: _published_version(_branch_skipping_graph()))
    ctx = _app_context(sqlite_session)

    api = AppPublishApi()
    with app.test_request_context("/openapi/v1/apps/app-1:publish", method="POST"):
        response = cast(_EndpointView, api.post).__handler__(api, ctx, "app-1", body=PublishPayload())

    warning = cast(PublishResponse, response).warning
    assert warning is not None
    assert "Consumer" in warning
    assert "Producer" in warning


def test_publish_refusal_is_a_bad_request(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    service = _workflow_service(monkeypatch, sqlite_session_factory)

    def publish_workflow(**_kwargs: object) -> Workflow:
        raise ValueError("Node l (llm): Missing provider or model configuration")

    monkeypatch.setattr(service, "publish_workflow", publish_workflow)
    ctx = _app_context(sqlite_session)

    api = AppPublishApi()
    with app.test_request_context("/openapi/v1/apps/app-1:publish", method="POST"):
        with pytest.raises(BadRequest, match="Missing provider"):
            cast(_EndpointView, api.post).__handler__(api, ctx, "app-1", body=PublishPayload())

    stored_app = sqlite_session.get(App, APP_ID)
    assert stored_app is not None
    assert stored_app.workflow_id is None


def _add_run(session: Session, *, triggered_from: WorkflowRunTriggeredFrom) -> WorkflowRun:
    run = WorkflowRun(
        tenant_id=WORKSPACE_ID,
        app_id=APP_ID,
        workflow_id=VERSION_ID,
        type=WorkflowType.WORKFLOW,
        triggered_from=triggered_from,
        version="1",
        status=WorkflowExecutionStatus.SUCCEEDED,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=ACCOUNT_ID,
        graph="{}",
        inputs="{}",
    )
    session.add(run)
    session.commit()
    return run


def _listed_run_ids(
    app: Flask, ctx: Context, monkeypatch: pytest.MonkeyPatch, services: ApplicationServices, *, query: RunListQuery
) -> list[str]:
    monkeypatch.setattr(app_workflow, "application_services", lambda: services)
    api = AppRunListApi()
    with app.test_request_context(f"/openapi/v1/apps/{APP_ID}/runs"):
        response = cast(_EndpointView, api.get).__handler__(api, ctx, APP_ID, query=query)
    return [row.id for row in cast(RunListResponse, response).data]


@pytest.mark.parametrize(
    "triggered_from",
    [WorkflowRunTriggeredFrom.SCHEDULE, WorkflowRunTriggeredFrom.WEBHOOK, WorkflowRunTriggeredFrom.PLUGIN],
)
def test_run_list_lists_trigger_started_runs_only_when_asked(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    account_application_services: ApplicationServices,
    triggered_from: WorkflowRunTriggeredFrom,
) -> None:
    ctx = _app_context(sqlite_session)
    triggered = _add_run(sqlite_session, triggered_from=triggered_from)

    asked = _listed_run_ids(
        app,
        ctx,
        monkeypatch,
        account_application_services,
        query=RunListQuery.model_validate({"triggered_from": triggered_from}),
    )
    by_default = _listed_run_ids(app, ctx, monkeypatch, account_application_services, query=RunListQuery())

    assert asked == [triggered.id]
    assert by_default == []


@pytest.mark.parametrize("triggered_from", [WorkflowRunTriggeredFrom.RAG_PIPELINE_RUN, "unknown"])
def test_run_list_refuses_a_trigger_source_outside_the_app_runs(triggered_from: str) -> None:
    with pytest.raises(ValidationError):
        RunListQuery.model_validate({"triggered_from": triggered_from})
