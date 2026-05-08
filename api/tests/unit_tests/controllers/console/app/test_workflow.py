from __future__ import annotations

import json
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from werkzeug.exceptions import HTTPException, NotFound

from controllers.console.app import workflow as workflow_module
from controllers.console.app.error import DraftWorkflowNotExist, DraftWorkflowNotSync
from graphon.file import File, FileTransferMethod, FileType


def _unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


def test_parse_file_no_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_module.FileUploadConfigManager, "convert", lambda *_args, **_kwargs: None)
    workflow = SimpleNamespace(features_dict={}, tenant_id="t1")

    assert workflow_module._parse_file(workflow, files=[{"id": "f"}]) == []


def test_parse_file_with_config(monkeypatch: pytest.MonkeyPatch) -> None:
    config = object()
    file_list = [
        File(
            tenant_id="t1",
            file_type=FileType.IMAGE,
            transfer_method=FileTransferMethod.REMOTE_URL,
            remote_url="http://u",
        )
    ]
    build_mock = Mock(return_value=file_list)
    monkeypatch.setattr(workflow_module.FileUploadConfigManager, "convert", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(workflow_module.file_factory, "build_from_mappings", build_mock)

    workflow = SimpleNamespace(features_dict={}, tenant_id="t1")
    result = workflow_module._parse_file(workflow, files=[{"id": "f"}])

    assert result == file_list
    build_mock.assert_called_once()


def test_sync_draft_workflow_invalid_content_type(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = workflow_module.DraftWorkflowApi()
    handler = _unwrap(api.post)

    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (SimpleNamespace(), "t1"))

    with app.test_request_context("/apps/app/workflows/draft", method="POST", data="x", content_type="text/html"):
        with pytest.raises(HTTPException) as exc:
            handler(api, app_model=SimpleNamespace(id="app"))

    assert exc.value.code == 415


def test_sync_draft_workflow_invalid_json(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = workflow_module.DraftWorkflowApi()
    handler = _unwrap(api.post)

    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (SimpleNamespace(), "t1"))

    with app.test_request_context(
        "/apps/app/workflows/draft",
        method="POST",
        data="[]",
        content_type="application/json",
    ):
        response, status = handler(api, app_model=SimpleNamespace(id="app"))

    assert status == 400
    assert response["message"] == "Invalid JSON data"


def test_sync_draft_workflow_success(app, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = SimpleNamespace(
        unique_hash="h",
        updated_at=None,
        created_at=datetime(2024, 1, 1),
    )
    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (SimpleNamespace(), "t1"))
    monkeypatch.setattr(
        workflow_module.variable_factory, "build_environment_variable_from_mapping", lambda *_args: "env"
    )
    monkeypatch.setattr(
        workflow_module.variable_factory, "build_conversation_variable_from_mapping", lambda *_args: "conv"
    )

    service = SimpleNamespace(sync_draft_workflow=lambda **_kwargs: workflow)
    monkeypatch.setattr(workflow_module, "WorkflowService", lambda: service)

    api = workflow_module.DraftWorkflowApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/draft",
        method="POST",
        json={"graph": {}, "features": {}, "hash": "h"},
    ):
        response = handler(api, app_model=SimpleNamespace(id="app"))

    assert response["result"] == "success"


def test_sync_draft_workflow_hash_mismatch(app, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (SimpleNamespace(), "t1"))

    def _raise(*_args, **_kwargs):
        raise workflow_module.WorkflowHashNotEqualError()

    service = SimpleNamespace(sync_draft_workflow=_raise)
    monkeypatch.setattr(workflow_module, "WorkflowService", lambda: service)

    api = workflow_module.DraftWorkflowApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/draft",
        method="POST",
        json={"graph": {}, "features": {}, "hash": "h"},
    ):
        with pytest.raises(DraftWorkflowNotSync):
            handler(api, app_model=SimpleNamespace(id="app"))


def test_restore_published_workflow_to_draft_success(app, monkeypatch: pytest.MonkeyPatch) -> None:
    workflow = SimpleNamespace(
        unique_hash="restored-hash",
        updated_at=None,
        created_at=datetime(2024, 1, 1),
    )
    user = SimpleNamespace(id="account-1")

    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (user, "t1"))
    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(restore_published_workflow_to_draft=lambda **_kwargs: workflow),
    )

    api = workflow_module.DraftWorkflowRestoreApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/published-workflow/restore",
        method="POST",
    ):
        response = handler(
            api,
            app_model=SimpleNamespace(id="app", tenant_id="tenant-1"),
            workflow_id="published-workflow",
        )

    assert response["result"] == "success"
    assert response["hash"] == "restored-hash"


def test_restore_published_workflow_to_draft_not_found(app, monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(id="account-1")

    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (user, "t1"))
    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(
            restore_published_workflow_to_draft=lambda **_kwargs: (_ for _ in ()).throw(
                workflow_module.WorkflowNotFoundError("Workflow not found")
            )
        ),
    )

    api = workflow_module.DraftWorkflowRestoreApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/published-workflow/restore",
        method="POST",
    ):
        with pytest.raises(NotFound):
            handler(
                api,
                app_model=SimpleNamespace(id="app", tenant_id="tenant-1"),
                workflow_id="published-workflow",
            )


def test_restore_published_workflow_to_draft_returns_400_for_draft_source(app, monkeypatch: pytest.MonkeyPatch) -> None:
    user = SimpleNamespace(id="account-1")

    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (user, "t1"))
    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(
            restore_published_workflow_to_draft=lambda **_kwargs: (_ for _ in ()).throw(
                workflow_module.IsDraftWorkflowError(
                    "Cannot use draft workflow version. Workflow ID: draft-workflow. "
                    "Please use a published workflow version or leave workflow_id empty."
                )
            )
        ),
    )

    api = workflow_module.DraftWorkflowRestoreApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/draft-workflow/restore",
        method="POST",
    ):
        with pytest.raises(HTTPException) as exc:
            handler(
                api,
                app_model=SimpleNamespace(id="app", tenant_id="tenant-1"),
                workflow_id="draft-workflow",
            )

    assert exc.value.code == 400
    assert exc.value.description == workflow_module.RESTORE_SOURCE_WORKFLOW_MUST_BE_PUBLISHED_MESSAGE


def test_restore_published_workflow_to_draft_returns_400_for_invalid_structure(
    app, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = SimpleNamespace(id="account-1")

    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (user, "t1"))
    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(
            restore_published_workflow_to_draft=lambda **_kwargs: (_ for _ in ()).throw(
                ValueError("invalid workflow graph")
            )
        ),
    )

    api = workflow_module.DraftWorkflowRestoreApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/app/workflows/published-workflow/restore",
        method="POST",
    ):
        with pytest.raises(HTTPException) as exc:
            handler(
                api,
                app_model=SimpleNamespace(id="app", tenant_id="tenant-1"),
                workflow_id="published-workflow",
            )

    assert exc.value.code == 400
    assert exc.value.description == "invalid workflow graph"


def test_get_published_workflows_marshals_items_before_session_closes(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = workflow_module.PublishedAllWorkflowApi()
    handler = _unwrap(api.get)

    session_state = {"open": False}

    class _SessionContext:
        def __enter__(self):
            session_state["open"] = True
            return object()

        def __exit__(self, exc_type, exc, tb):
            session_state["open"] = False
            return False

    class _SessionMaker:
        def begin(self):
            return _SessionContext()

    class _Workflow:
        @property
        def id(self):
            assert session_state["open"] is True
            return "w1"

    monkeypatch.setattr(workflow_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(workflow_module, "sessionmaker", lambda *_args, **_kwargs: _SessionMaker())
    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (SimpleNamespace(id="u1"), "t1"))
    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(
            get_all_published_workflow=lambda **_kwargs: ([_Workflow()], False),
        ),
    )

    def _fake_marshal(items, fields):
        assert session_state["open"] is True
        return [{"id": item.id} for item in items]

    monkeypatch.setattr(workflow_module, "marshal", _fake_marshal)

    with app.test_request_context(
        "/apps/app/workflows",
        method="GET",
        query_string={"page": 1, "limit": 10, "user_id": "", "named_only": "false"},
    ):
        response = handler(api, app_model=SimpleNamespace(id="app", workflow_id="wf-1"))

    assert response == {
        "items": [{"id": "w1"}],
        "page": 1,
        "limit": 10,
        "has_more": False,
    }


def test_draft_workflow_get_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        workflow_module, "WorkflowService", lambda: SimpleNamespace(get_draft_workflow=lambda **_k: None)
    )

    api = workflow_module.DraftWorkflowApi()
    handler = _unwrap(api.get)

    with pytest.raises(DraftWorkflowNotExist):
        handler(api, app_model=SimpleNamespace(id="app"))


def test_advanced_chat_run_conversation_not_exists(app, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        workflow_module.AppGenerateService,
        "generate",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            workflow_module.services.errors.conversation.ConversationNotExistsError()
        ),
    )
    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (SimpleNamespace(), "t1"))

    api = workflow_module.AdvancedChatDraftWorkflowRunApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/app/advanced-chat/workflows/draft/run",
        method="POST",
        json={"inputs": {}},
    ):
        with pytest.raises(NotFound):
            handler(api, app_model=SimpleNamespace(id="app"))


def test_workflow_online_users_filters_inaccessible_workflow(app, monkeypatch: pytest.MonkeyPatch) -> None:
    app_id_1 = "11111111-1111-1111-1111-111111111111"
    app_id_2 = "22222222-2222-2222-2222-222222222222"
    signed_avatar_url = "https://files.example.com/signed/avatar-1"
    sign_avatar = Mock(return_value=signed_avatar_url)
    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (SimpleNamespace(), "tenant-1"))
    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(get_accessible_app_ids=lambda app_ids, tenant_id: {app_id_1}),
    )
    monkeypatch.setattr(workflow_module.file_helpers, "get_signed_file_url", sign_avatar)

    redis_pipeline = Mock()
    redis_pipeline.execute.return_value = [
        {
            b"sid-1": json.dumps(
                {
                    "user_id": "u-1",
                    "username": "Alice",
                    "avatar": "avatar-file-id",
                    "sid": "sid-1",
                }
            )
        }
    ]
    workflow_module.redis_client.pipeline.return_value = redis_pipeline

    api = workflow_module.WorkflowOnlineUsersApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/workflows/online-users",
        method="POST",
        json={"app_ids": [app_id_1, app_id_2]},
    ):
        response = handler(api)

    assert response == {
        "data": [
            {
                "app_id": app_id_1,
                "users": [
                    {
                        "user_id": "u-1",
                        "username": "Alice",
                        "avatar": signed_avatar_url,
                        "sid": "sid-1",
                    }
                ],
            }
        ]
    }
    workflow_module.redis_client.pipeline.assert_called_once_with(transaction=False)
    redis_pipeline.hgetall.assert_called_once_with(f"{workflow_module.WORKFLOW_ONLINE_USERS_PREFIX}{app_id_1}")
    redis_pipeline.execute.assert_called_once_with()
    sign_avatar.assert_called_once_with("avatar-file-id")


def test_workflow_online_users_batches_redis_reads(app, monkeypatch: pytest.MonkeyPatch) -> None:
    app_ids = [f"wf-{index}" for index in range(workflow_module.WORKFLOW_ONLINE_USERS_REDIS_BATCH_SIZE + 1)]
    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (SimpleNamespace(), "tenant-1"))
    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(get_accessible_app_ids=lambda app_ids, tenant_id: set(app_ids)),
    )

    first_pipeline = Mock()
    first_pipeline.execute.return_value = [{} for _ in range(workflow_module.WORKFLOW_ONLINE_USERS_REDIS_BATCH_SIZE)]
    second_pipeline = Mock()
    second_pipeline.execute.return_value = [{}]
    workflow_module.redis_client.pipeline.side_effect = [first_pipeline, second_pipeline]

    api = workflow_module.WorkflowOnlineUsersApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/workflows/online-users",
        method="POST",
        json={"app_ids": app_ids},
    ):
        response = handler(api)

    assert len(response["data"]) == len(app_ids)
    assert workflow_module.redis_client.pipeline.call_count == 2
    assert first_pipeline.hgetall.call_count == workflow_module.WORKFLOW_ONLINE_USERS_REDIS_BATCH_SIZE
    assert second_pipeline.hgetall.call_count == 1


def test_workflow_online_users_rejects_excessive_workflow_ids(app, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_module, "current_account_with_tenant", lambda: (SimpleNamespace(), "tenant-1"))
    accessible_app_ids = Mock(return_value=set())
    monkeypatch.setattr(
        workflow_module,
        "WorkflowService",
        lambda: SimpleNamespace(get_accessible_app_ids=accessible_app_ids),
    )

    excessive_ids = [f"wf-{index}" for index in range(workflow_module.MAX_WORKFLOW_ONLINE_USERS_REQUEST_IDS + 1)]

    api = workflow_module.WorkflowOnlineUsersApi()
    handler = _unwrap(api.post)

    with app.test_request_context(
        "/apps/workflows/online-users",
        method="POST",
        json={"app_ids": excessive_ids},
    ):
        with pytest.raises(HTTPException) as exc:
            handler(api)

    assert exc.value.code == 400
    assert "Maximum" in exc.value.description
    accessible_app_ids.assert_not_called()
