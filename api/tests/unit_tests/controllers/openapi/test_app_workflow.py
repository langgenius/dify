from collections.abc import Callable
from types import SimpleNamespace
from typing import Protocol, cast
from unittest.mock import Mock

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.openapi import app_workflow
from controllers.openapi._errors import (
    DraftNotFound,
    EnvVariableNotFound,
    RunNotFound,
    SecretMaskNotSecret,
    SecretMaskUnknownId,
    VersionNotFound,
)
from controllers.openapi._models import (
    AdvancedChatNodeRunPayload,
    EnvVariableSetPayload,
    NodeRunPayload,
    RestoreResponse,
    RunListQuery,
    RunListResponse,
    VersionListQuery,
)
from controllers.openapi._upload import file_fields
from controllers.openapi.app_workflow import (
    AppEnvItemApi,
    AppRunNodeListApi,
    AppVersionListApi,
    AppVersionRestoreApi,
    env_variable_rows,
    run_draft_node,
    with_next_cursor,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import Subject
from core.helper import encrypter
from graphon.variables import SecretVariable, StringVariable
from models.account import Account, Tenant
from models.model import App, AppMode
from models.workflow import Workflow


class _EndpointView(Protocol):
    """Structural stand-in for a `view` carrying the attributes `@endpoint` attaches."""

    __handler__: Callable[..., object]


def _app_context(app_id: str = "app-1", **view_args: str) -> Context:
    ctx = Context(cast(Subject, SimpleNamespace(account_id="account-1")), Mock(), {"app_id": app_id, **view_args})
    ctx._workspace = Tenant(name="w")
    ctx._workspace.id = "tenant-1"
    ctx._app = App(id=app_id, tenant_id="tenant-1", name="a", mode=AppMode.WORKFLOW, enable_site=True, enable_api=True)
    account = Account(name="tester", email="tester@example.com")
    account.id = "account-1"
    ctx._caller = account
    return ctx


def _fake_workflow_service(monkeypatch: pytest.MonkeyPatch) -> Mock:
    """Stand in for `WorkflowService()`: the real constructor needs a live db.engine,
    which the bare Flask app these tests run under does not have."""
    service = Mock()
    monkeypatch.setattr(app_workflow, "WorkflowService", lambda: service)
    return service


def test_env_variable_view_masks_only_secrets_that_have_a_value() -> None:
    """An empty secret reads back empty, not masked: masking it would claim a value that is not there."""
    secret = SecretVariable(id="s", name="KEY", value="plain", selector=["env", "KEY"])
    empty_secret = SecretVariable(id="e", name="BLANK", value="", selector=["env", "BLANK"])
    plain = StringVariable(id="p", name="URL", value="https://x", selector=["env", "URL"])
    rows = env_variable_rows([secret, empty_secret, plain])
    assert [row.value for row in rows] == [encrypter.full_mask_token(), "", "https://x"]


def test_run_list_hints_the_next_cursor() -> None:
    page = RunListResponse.model_validate({"limit": 1, "has_more": True, "data": [{"id": "run-1"}]})
    hinted = with_next_cursor(page, op="get.run", app_id="app-1", query=RunListQuery(limit=1))
    assert hinted.hints[0].input == {"app_id": "app-1", "limit": 1, "last_id": "run-1"}


def test_set_env_rejects_mask_for_unknown_id(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Sending the mask for an id that is not a stored secret must not encrypt the
    literal mask into the draft (the bug: it silently succeeded, storing `[__HIDDEN__]`)."""
    service = _fake_workflow_service(monkeypatch)
    service.get_draft_workflow.return_value = SimpleNamespace(environment_variables=[])

    body = EnvVariableSetPayload(name="KEY", value_type="secret", value=encrypter.full_mask_token())
    api = AppEnvItemApi()
    ctx = _app_context(env_id="unknown-id")
    with app.test_request_context("/openapi/v1/apps/app-1/env/unknown-id", method="PUT"):
        with pytest.raises(SecretMaskUnknownId):
            cast(_EndpointView, api.put).__handler__(api, ctx, "app-1", "unknown-id", body=body)

    service.patch_draft_workflow_environment_variables.assert_not_called()


def test_set_env_accepts_mask_for_a_stored_secret(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """The same mask for an id that *is* a stored secret keeps the existing flow working."""
    stored = SecretVariable(id="s-1", name="KEY", value="plain", selector=["env", "KEY"])
    service = _fake_workflow_service(monkeypatch)
    service.get_draft_workflow.return_value = SimpleNamespace(environment_variables=[stored])

    body = EnvVariableSetPayload(name="KEY", value_type="secret", value=encrypter.full_mask_token())
    api = AppEnvItemApi()
    ctx = _app_context(env_id="s-1")
    with app.test_request_context("/openapi/v1/apps/app-1/env/s-1", method="PUT"):
        cast(_EndpointView, api.put).__handler__(api, ctx, "app-1", "s-1", body=body)

    service.patch_draft_workflow_environment_variables.assert_called_once()


def test_set_env_rejects_the_mask_as_a_plain_value(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Re-typing a stored secret as a string while sending the mask would store the mask text
    and destroy the secret."""
    stored = SecretVariable(id="s-1", name="KEY", value="plain", selector=["env", "KEY"])
    service = _fake_workflow_service(monkeypatch)
    service.get_draft_workflow.return_value = SimpleNamespace(environment_variables=[stored])

    body = EnvVariableSetPayload(name="KEY", value_type="string", value=encrypter.full_mask_token())
    api = AppEnvItemApi()
    with app.test_request_context("/openapi/v1/apps/app-1/env/s-1", method="PUT"):
        with pytest.raises(SecretMaskNotSecret):
            cast(_EndpointView, api.put).__handler__(api, _app_context(env_id="s-1"), "app-1", "s-1", body=body)

    service.patch_draft_workflow_environment_variables.assert_not_called()


def test_set_env_without_a_draft_is_not_found(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    service = _fake_workflow_service(monkeypatch)
    service.get_draft_workflow.return_value = None

    body = EnvVariableSetPayload(name="KEY", value_type="string", value="v")
    api = AppEnvItemApi()
    with app.test_request_context("/openapi/v1/apps/app-1/env/e-1", method="PUT"):
        with pytest.raises(DraftNotFound):
            cast(_EndpointView, api.put).__handler__(api, _app_context(env_id="e-1"), "app-1", "e-1", body=body)

    service.patch_draft_workflow_environment_variables.assert_not_called()


def test_delete_env_without_a_draft_is_not_found(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    service = _fake_workflow_service(monkeypatch)
    service.get_draft_workflow.return_value = None

    api = AppEnvItemApi()
    with app.test_request_context("/openapi/v1/apps/app-1/env/e-1", method="DELETE"):
        with pytest.raises(DraftNotFound):
            cast(_EndpointView, api.delete).__handler__(api, _app_context(env_id="e-1"), "app-1", "e-1")

    service.patch_draft_workflow_environment_variables.assert_not_called()


def test_delete_env_with_an_unknown_id_is_not_found(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """An unknown id must not report success while deleting nothing."""
    stored = StringVariable(id="e-1", name="KEY", value="v", selector=["env", "KEY"])
    service = _fake_workflow_service(monkeypatch)
    service.get_draft_workflow.return_value = SimpleNamespace(environment_variables=[stored])

    api = AppEnvItemApi()
    with app.test_request_context("/openapi/v1/apps/app-1/env/typo", method="DELETE"):
        with pytest.raises(EnvVariableNotFound):
            cast(_EndpointView, api.delete).__handler__(api, _app_context(env_id="typo"), "app-1", "typo")

    service.patch_draft_workflow_environment_variables.assert_not_called()


def test_delete_env_removes_a_stored_variable(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    stored = StringVariable(id="e-1", name="KEY", value="v", selector=["env", "KEY"])
    service = _fake_workflow_service(monkeypatch)
    service.get_draft_workflow.return_value = SimpleNamespace(environment_variables=[stored])

    api = AppEnvItemApi()
    with app.test_request_context("/openapi/v1/apps/app-1/env/e-1", method="DELETE"):
        cast(_EndpointView, api.delete).__handler__(api, _app_context(env_id="e-1"), "app-1", "e-1")

    service.patch_draft_workflow_environment_variables.assert_called_once()
    assert service.patch_draft_workflow_environment_variables.call_args.kwargs["deleted_environment_variable_ids"] == [
        "e-1"
    ]


def test_set_env_payload_rejects_a_value_type_the_console_does_not_allow() -> None:
    with pytest.raises(ValidationError):
        EnvVariableSetPayload(name="KEY", value_type="boolean", value=True)


def test_restore_rejects_a_garbage_version_id(app: Flask) -> None:
    api = AppVersionRestoreApi()
    ctx = _app_context(version_id="not-a-uuid")
    with app.test_request_context("/openapi/v1/apps/app-1/versions/not-a-uuid:restore", method="POST"):
        with pytest.raises(VersionNotFound):
            cast(_EndpointView, api.post).__handler__(api, ctx, "app-1", "not-a-uuid")


def test_version_list_excludes_the_draft(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    service = _fake_workflow_service(monkeypatch)
    no_versions: list[Workflow] = []
    service.get_all_published_workflow.return_value = (no_versions, False)

    api = AppVersionListApi()
    with app.test_request_context("/openapi/v1/apps/app-1/versions"):
        cast(_EndpointView, api.get).__handler__(api, _app_context(), "app-1", query=VersionListQuery())

    assert service.get_all_published_workflow.call_args.kwargs["include_draft"] is False


def test_restore_returns_the_hash_an_import_checks(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    service = _fake_workflow_service(monkeypatch)
    service.restore_published_workflow_to_draft.return_value = SimpleNamespace(
        unique_hash="graph-only-hash", content_hash="whole-draft-hash"
    )
    monkeypatch.setattr(app_workflow.db, "session", lambda: None)
    version_id = "11111111-1111-4111-8111-111111111111"

    api = AppVersionRestoreApi()
    with app.test_request_context(f"/openapi/v1/apps/app-1/versions/{version_id}:restore", method="POST"):
        response = cast(_EndpointView, api.post).__handler__(
            api, _app_context(version_id=version_id), "app-1", version_id
        )

    assert cast(RestoreResponse, response).draft_hash == "whole-draft-hash"


def test_run_node_list_is_not_found_for_a_run_of_another_app(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Match describe: an unknown run is a 404, not an empty step list."""
    runs = Mock()
    runs.get_workflow_run.return_value = None
    monkeypatch.setattr(app_workflow, "application_services", lambda: SimpleNamespace(workflow_runs=runs))
    run_id = "11111111-1111-4111-8111-111111111111"

    api = AppRunNodeListApi()
    with app.test_request_context(f"/openapi/v1/apps/app-1/runs/{run_id}/nodes"):
        with pytest.raises(RunNotFound):
            cast(_EndpointView, api.get).__handler__(api, _app_context(run_id=run_id), "app-1", run_id)

    runs.get_workflow_run_node_executions.assert_not_called()


@pytest.mark.parametrize("payload_cls", [NodeRunPayload, AdvancedChatNodeRunPayload])
def test_node_run_payload_accepts_files_and_forbids_attachments(payload_cls: type[NodeRunPayload]) -> None:
    assert payload_cls.model_validate({"inputs": {}, "files": None}).files is None
    with pytest.raises(ValidationError):
        payload_cls.model_validate({"attachments": []})


def test_run_draft_node_merges_local_files_into_the_inputs(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _fake_workflow_service(monkeypatch)
    service.get_draft_workflow.return_value = SimpleNamespace(graph_dict={"nodes": [{"id": "n1", "data": {}}]})
    merge = Mock(return_value={"x": 1, "doc": {"id": "file-1"}})
    monkeypatch.setattr(app_workflow, "merge_files", merge)
    monkeypatch.setattr(app_workflow, "node_execution_response_source", lambda *_args, **_kwargs: {"id": "e-1"})
    monkeypatch.setattr(app_workflow.WorkflowRunNodeExecutionResponse, "model_validate", Mock())
    ctx = _app_context()
    parts = {"doc": Mock()}

    run_draft_node(ctx, "n1", inputs={"x": 1}, query="", files=parts)

    merge.assert_called_once_with({"x": 1}, parts, ctx.caller)
    assert service.run_draft_workflow_node.call_args.kwargs["user_inputs"] == {"x": 1, "doc": {"id": "file-1"}}


def test_node_run_payloads_take_files_as_multipart_parts() -> None:
    assert file_fields(NodeRunPayload) == {"files"}
    assert file_fields(AdvancedChatNodeRunPayload) == {"files"}


@pytest.mark.parametrize(("files", "ends_transaction"), [({"doc": Mock()}, True), (None, False)])
def test_run_draft_node_ends_the_read_transaction_before_uploading(
    monkeypatch: pytest.MonkeyPatch, files: dict[str, Mock] | None, ends_transaction: bool
) -> None:
    service = _fake_workflow_service(monkeypatch)
    service.get_draft_workflow.return_value = SimpleNamespace(graph_dict={"nodes": [{"id": "n1", "data": {}}]})
    calls = Mock()
    monkeypatch.setattr(app_workflow, "end_read_transaction", calls.end)
    monkeypatch.setattr(app_workflow, "merge_files", calls.merge)
    monkeypatch.setattr(app_workflow, "node_execution_response_source", lambda *_args, **_kwargs: {"id": "e-1"})
    monkeypatch.setattr(app_workflow.WorkflowRunNodeExecutionResponse, "model_validate", Mock())
    ctx = _app_context()

    run_draft_node(ctx, "n1", inputs={}, query="", files=files)

    names = [call[0] for call in calls.mock_calls]
    assert names == (["end", "merge"] if ends_transaction else ["merge"])
