import inspect
from datetime import UTC, datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import httpx
import pytest
from flask import Flask
from werkzeug.exceptions import NotFound

from controllers.inner_api.app import files as module
from models.enums import EndUserType


def _identity() -> dict[str, str]:
    return {
        "tenant_id": "tenant-1",
        "app_id": "app-1",
        "environment_id": "environment-1",
        "subject_id": "subject-1",
        "subject_type": "anonymous",
    }


def _identity_headers() -> dict[str, str]:
    identity = _identity()
    return {
        "X-AppDeploy-Tenant-ID": identity["tenant_id"],
        "X-AppDeploy-App-ID": identity["app_id"],
        "X-AppDeploy-Environment-ID": identity["environment_id"],
        "X-AppDeploy-Subject-ID": identity["subject_id"],
        "X-AppDeploy-Subject-Type": identity["subject_type"],
    }


def _upload_file(file_id: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=file_id,
        name=f"{file_id}.txt",
        size=3,
        extension="txt",
        mime_type="text/plain",
        created_by="end-user-1",
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def test_app_deploy_identity_uses_environment_scoped_end_user_session(app: Flask) -> None:
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    end_user = SimpleNamespace(id="end-user-1")
    session = MagicMock()
    session.__enter__.return_value = session
    session.__exit__.return_value = False
    session.begin.return_value.__enter__.return_value = session
    session.begin.return_value.__exit__.return_value = False
    session.scalar.side_effect = [app_model, end_user]

    with (
        patch.object(module, "db"),
        patch.object(module, "Session", return_value=session),
    ):
        with app.test_request_context():
            assert module._get_end_user(module.AppDeployFileIdentity.model_validate(_identity())) is end_user

    end_user_query = session.scalar.call_args_list[1].args[0]
    app_query = session.scalar.call_args_list[0].args[0]
    assert app_query._for_update_arg is not None
    assert "end_users.type" in str(end_user_query)
    assert "end_users.tenant_id" in str(end_user_query)
    assert "end_users.app_id" in str(end_user_query)
    session.add.assert_not_called()


@pytest.mark.parametrize(
    ("subject_type", "is_anonymous"), [("anonymous", True), ("account", False), ("external", False)]
)
def test_app_deploy_identity_does_not_reuse_another_end_user_type(
    app: Flask, subject_type: str, is_anonymous: bool
) -> None:
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    session = MagicMock()
    session.__enter__.return_value = session
    session.__exit__.return_value = False
    session.begin.return_value.__enter__.return_value = session
    session.begin.return_value.__exit__.return_value = False
    session.scalar.side_effect = [app_model, None]

    with (
        patch.object(module, "db"),
        patch.object(module, "Session", return_value=session),
    ):
        with app.test_request_context():
            identity = module.AppDeployFileIdentity.model_validate({**_identity(), "subject_type": subject_type})
            end_user = module._get_end_user(identity)

    assert end_user.type == EndUserType.APP_DEPLOY
    assert end_user.session_id == f"appdeploy:environment-1:{subject_type}:subject-1"
    assert end_user._is_anonymous is is_anonymous
    session.add.assert_called_once_with(end_user)


def test_app_deploy_identity_ignores_request_body_identity_fields(app: Flask) -> None:
    with app.test_request_context(
        json={
            "tenant_id": "browser-tenant",
            "app_id": "browser-app",
            "environment_id": "browser-environment",
            "subject_id": "browser-subject",
            "subject_type": "account",
        },
        headers=_identity_headers(),
    ):
        assert module._identity_from_request() == module.AppDeployFileIdentity.model_validate(_identity())


def test_app_deploy_session_identity_separates_subject_types() -> None:
    assert module._session_identity(
        environment_id="environment-1", subject_type="anonymous", subject_id="subject-1"
    ) != module._session_identity(environment_id="environment-1", subject_type="account", subject_id="subject-1")


def test_app_deploy_session_identity_separates_environments() -> None:
    assert module._session_identity(
        environment_id="environment-1", subject_type="anonymous", subject_id="subject-1"
    ) != module._session_identity(environment_id="environment-2", subject_type="anonymous", subject_id="subject-1")


def test_resolve_preserves_order_and_reuses_signed_urls(app: Flask) -> None:
    api = module.EnterpriseAppDeployFileResolve()
    handler = inspect.unwrap(api.post)
    session = MagicMock()
    session.__enter__.return_value = session
    session.__exit__.return_value = False
    session.scalars.return_value.all.return_value = [_upload_file("file-1"), _upload_file("file-2")]
    with (
        patch.object(module, "db"),
        patch.object(module.dify_config, "FILES_ACCESS_TIMEOUT", module.DEFAULT_LOCATOR_TTL),
        patch.object(module, "_get_end_user", return_value=SimpleNamespace(id="end-user-1")),
        patch.object(module, "Session", return_value=session),
        patch.object(module, "FileService") as file_service,
        patch.object(
            module.file_helpers,
            "get_signed_file_url",
            side_effect=lambda upload_file_id: f"signed-{upload_file_id}",
        ) as get_signed_file_url,
    ):
        with app.test_request_context(json={"file_ids": ["file-2", "file-1", "file-2"]}, headers=_identity_headers()):
            body, status_code = handler(api)

    assert status_code == 200
    assert [file["id"] for file in body["files"]] == ["file-2", "file-1", "file-2"]
    assert [file["url"] for file in body["files"]] == ["signed-file-2", "signed-file-1", "signed-file-2"]
    assert get_signed_file_url.call_args_list == [
        call(upload_file_id="file-2"),
        call(upload_file_id="file-1"),
    ]
    file_service.assert_not_called()


def test_resolve_fails_when_file_locator_timeout_is_too_short(app: Flask) -> None:
    api = module.EnterpriseAppDeployFileResolve()
    handler = inspect.unwrap(api.post)

    with (
        patch.object(module.dify_config, "FILES_ACCESS_TIMEOUT", module.DEFAULT_LOCATOR_TTL - 1),
        patch.object(module, "_get_end_user") as get_end_user,
    ):
        with app.test_request_context(json={"file_ids": ["file-1"]}, headers=_identity_headers()):
            with pytest.raises(module.ServiceUnavailable):
                handler(api)

    get_end_user.assert_not_called()


def test_resolve_fails_the_entire_batch_when_one_file_is_not_owned(app: Flask) -> None:
    api = module.EnterpriseAppDeployFileResolve()
    handler = inspect.unwrap(api.post)
    session = MagicMock()
    session.__enter__.return_value = session
    session.__exit__.return_value = False
    session.scalars.return_value.all.return_value = [_upload_file("file-1")]

    with (
        patch.object(module, "db"),
        patch.object(module.dify_config, "FILES_ACCESS_TIMEOUT", module.DEFAULT_LOCATOR_TTL),
        patch.object(module, "_get_end_user", return_value=SimpleNamespace(id="end-user-1")),
        patch.object(module, "Session", return_value=session),
        patch.object(module, "FileService") as file_service,
    ):
        with app.test_request_context(json={"file_ids": ["file-1", "other-users-file"]}, headers=_identity_headers()):
            with pytest.raises(NotFound):
                handler(api)

    file_service.assert_not_called()


def test_upload_reuses_file_service_with_end_user_owner(app: Flask) -> None:
    api = module.EnterpriseAppDeployFileUpload()
    handler = inspect.unwrap(api.post)
    end_user = SimpleNamespace(id="end-user-1")
    upload_file = _upload_file("file-1")
    file_service = MagicMock()
    file_service.upload_file.return_value = upload_file

    with (
        patch.object(module, "db"),
        patch.object(module, "_get_end_user", return_value=end_user),
        patch.object(module, "FileService", return_value=file_service),
        patch.object(module.file_helpers, "get_signed_file_url", return_value="preview-file-1"),
    ):
        with app.test_request_context(
            method="POST",
            data={"file": (BytesIO(b"content"), "upload.txt", "text/plain")},
            headers=_identity_headers(),
        ):
            _body, status_code = handler(api)

    assert status_code == 201
    assert file_service.upload_file.call_args.kwargs["user"] is end_user


def test_upload_rejects_content_larger_than_the_global_maximum(app: Flask) -> None:
    api = module.EnterpriseAppDeployFileUpload()
    handler = inspect.unwrap(api.post)

    with (
        patch.object(module, "_get_end_user", return_value=SimpleNamespace(id="end-user-1")),
        patch.object(module, "_max_upload_bytes", return_value=3),
        patch.object(module, "FileService") as file_service,
    ):
        with app.test_request_context(
            method="POST",
            data={"file": (BytesIO(b"1234"), "upload.txt", "text/plain")},
            headers=_identity_headers(),
        ):
            with pytest.raises(module.FileTooLargeError):
                handler(api)

    file_service.assert_not_called()


@pytest.mark.parametrize("headers", [{}, {"Content-Length": "1"}])
def test_remote_upload_limits_the_streamed_response_without_trusting_content_length(headers: dict[str, str]) -> None:
    response = httpx.Response(200, headers=headers, content=b"1234")

    with (
        patch.object(module.remote_fetcher, "make_request", return_value=response),
        patch.object(module, "_max_upload_bytes", return_value=3),
        patch.object(module, "FileService") as file_service,
    ):
        with pytest.raises(module.FileTooLargeError):
            module._upload_remote_file(
                url="https://files.example.com/input.txt",
                end_user=SimpleNamespace(id="end-user-1"),
            )

    file_service.assert_not_called()


@pytest.mark.parametrize(
    "error",
    [
        module.ssrf_proxy.MaxRetriesExceededError("retries exhausted"),
        module.ssrf_proxy.UnsupportedResponseEncodingError("content encoding gzip"),
        module.ToolSSRFError("blocked"),
    ],
)
def test_remote_upload_reports_fetch_failures(error: Exception) -> None:
    with (
        patch.object(module.remote_fetcher, "make_request", side_effect=error),
        patch.object(module, "FileService") as file_service,
    ):
        with pytest.raises(module.RemoteFileUploadError):
            module._upload_remote_file(
                url="https://files.example.com/input.txt",
                end_user=SimpleNamespace(id="end-user-1"),
            )

    file_service.assert_not_called()


def test_file_config_supplies_every_upload_config_field(app: Flask) -> None:
    with app.test_request_context("/inner/api/enterprise/app-deploy/files/config"):
        body, status = module.EnterpriseAppDeployFileConfig().get.__wrapped__(module.EnterpriseAppDeployFileConfig())

    assert status == 200
    assert set(body) == set(module.UploadConfig.model_fields)
