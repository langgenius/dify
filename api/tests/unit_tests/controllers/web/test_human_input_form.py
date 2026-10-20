"""Unit tests for controllers.web.human_input_form endpoints."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Engine
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

import controllers.web.human_input_form as human_input_module
from controllers.common.errors import NotFoundError
from controllers.web.error import WebFormRateLimitExceededError
from core.workflow.nodes.human_input.entities import ParagraphInputConfig, SelectInputConfig, StringListSource
from core.workflow.nodes.human_input.enums import ValueSourceType
from models import Tenant
from models.account import TenantStatus
from models.enums import CustomizeTokenStrategy
from models.human_input import RecipientType
from models.model import App, AppMode, IconType, Site
from services.entities.feature_entities import FeatureModel
from services.human_input_service import FormExpiredError

HumanInputFormApi = human_input_module.HumanInputFormApi
HumanInputFormUploadTokenApi = human_input_module.HumanInputFormUploadTokenApi

SQLITE_MODELS = (Tenant, App, Site)
pytestmark = [
    pytest.mark.usefixtures("sqlite_session"),
    pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True),
]


@pytest.fixture
def app() -> Flask:
    """Configure a minimal Flask app for request contexts."""

    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def database_session(
    sqlite_session: Session,
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> Session:
    """Bind model/controller database access to the shared SQLite session."""

    database = SimpleNamespace(engine=sqlite_engine, session=sqlite_session)
    monkeypatch.setattr(human_input_module, "db", database)
    monkeypatch.setattr("models.model.db", database)
    return sqlite_session


def _persist_app_site(session: Session, *, include_site: bool = True) -> tuple[Tenant, App, Site | None]:
    tenant = Tenant(name="Tenant", plan="basic")
    tenant.custom_config_dict = {"remove_webapp_brand": True, "replace_webapp_logo": None}
    app_model = App(
        id=str(uuid4()),
        tenant_id=tenant.id,
        name="Human Input App",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#fff",
        enable_site=True,
        enable_api=False,
    )
    site = None
    models: list[object] = [tenant, app_model]
    if include_site:
        site = Site(
            app_id=app_model.id,
            title="My Site",
            default_language="en",
            customize_token_strategy=CustomizeTokenStrategy.UUID,
            icon_type=IconType.EMOJI,
            icon="robot",
            icon_background="#fff",
            description="desc",
            input_placeholder="Ask the app",
            chat_color_theme="light",
            chat_color_theme_inverted=False,
            custom_disclaimer="",
            prompt_public=False,
            show_workflow_steps=True,
            use_icon_as_answer_icon=False,
        )
        models.append(site)
    session.add_all(models)
    session.commit()
    return tenant, app_model, site


def test_get_form_includes_site(monkeypatch: pytest.MonkeyPatch, app: Flask, database_session: Session):
    """GET returns form definition merged with site payload."""

    expiration_time = datetime(2099, 1, 1, tzinfo=UTC)
    _, app_model, _ = _persist_app_site(database_session)

    class _FakeDefinition:
        def model_dump(self, mode: str | None = None):
            return {
                "form_content": "Raw content",
                "rendered_content": "Rendered {{#$output.name#}}",
                "inputs": [{"type": "text", "output_variable_name": "name", "default": None}],
                "default_values": {"name": "Alice", "age": 30, "meta": {"k": "v"}},
                "user_actions": [{"id": "approve", "title": "Approve", "button_style": "default"}],
            }

    class _FakeForm:
        def __init__(self, expiration: datetime):
            self.workflow_run_id = None
            self.app_id = app_model.id
            self.tenant_id = app_model.tenant_id
            self.expiration_time = expiration
            self.recipient_type = RecipientType.BACKSTAGE

        def get_definition(self):
            return _FakeDefinition()

    form = _FakeForm(expiration_time)
    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_ACCESS_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")

    # Patch service to return fake form.
    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = form
    resolved_input = ParagraphInputConfig(output_variable_name="name")
    service_mock.resolve_form_inputs.return_value = [resolved_input]
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    monkeypatch.setattr(
        human_input_module.FeatureService,
        "get_features",
        lambda tenant_id, **_kwargs: FeatureModel(can_replace_logo=True, webapp_copyright_enabled=True),
    )

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        response = HumanInputFormApi().get("token-1")

    body = response
    assert set(body.keys()) == {
        "site",
        "form_content",
        "inputs",
        "resolved_default_values",
        "user_actions",
        "expiration_time",
    }
    assert body["form_content"] == "Rendered {{#$output.name#}}"
    assert body["inputs"] == [resolved_input.model_dump(mode="json")]
    assert body["resolved_default_values"] == {"name": "Alice", "age": "30", "meta": '{"k": "v"}'}
    assert body["user_actions"] == [{"id": "approve", "title": "Approve", "button_style": "default"}]
    assert body["expiration_time"] == int(expiration_time.timestamp())
    assert body["site"] == {
        "app_id": app_model.id,
        "mode": "chat",
        "end_user_id": None,
        "enable_site": True,
        "site": {
            "title": "My Site",
            "chat_color_theme": "light",
            "chat_color_theme_inverted": False,
            "icon_type": "emoji",
            "icon": "robot",
            "icon_background": "#fff",
            "icon_url": None,
            "description": "desc",
            "copyright": None,
            "privacy_policy": None,
            "input_placeholder": "Ask the app",
            "custom_disclaimer": "",
            "default_language": "en",
            "prompt_public": False,
            "show_workflow_steps": True,
            "use_icon_as_answer_icon": False,
        },
        "model_config": None,
        "plan": "basic",
        "can_replace_logo": True,
        "custom_config": {
            "remove_webapp_brand": True,
            "replace_webapp_logo": None,
        },
    }
    service_mock.get_form_by_token.assert_called_once_with("token-1")
    limiter_mock.is_rate_limited.assert_called_once_with("203.0.113.10")
    limiter_mock.increment_rate_limit.assert_called_once_with("203.0.113.10")


def test_get_form_uses_runtime_select_options(monkeypatch: pytest.MonkeyPatch, app: Flask, database_session: Session):
    """GET returns variable-backed select options resolved from runtime state."""

    expiration_time = datetime(2099, 1, 1, tzinfo=UTC)
    _, app_model, _ = _persist_app_site(database_session)
    configured_inputs = [
        {
            "type": "select",
            "output_variable_name": "decision",
            "option_source": {
                "type": "variable",
                "selector": ["start", "options"],
                "value": ["configured"],
            },
        }
    ]
    runtime_inputs = [
        SelectInputConfig(
            output_variable_name="decision",
            option_source=StringListSource(
                type=ValueSourceType.VARIABLE,
                selector=["start", "options"],
                value=["approve", "reject"],
            ),
        )
    ]

    class _FakeDefinition:
        def model_dump(self, mode: str | None = None):
            return {
                "form_content": "Raw content",
                "rendered_content": "Rendered",
                "inputs": configured_inputs,
                "default_values": {},
                "user_actions": [],
            }

    class _FakeForm:
        def __init__(self, expiration: datetime):
            self.workflow_run_id = None
            self.app_id = app_model.id
            self.tenant_id = app_model.tenant_id
            self.recipient_type = RecipientType.STANDALONE_WEB_APP
            self.expiration_time = expiration

        def get_definition(self):
            return _FakeDefinition()

    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_ACCESS_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")

    form = _FakeForm(expiration_time)
    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = form
    service_mock.resolve_form_inputs.return_value = runtime_inputs
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    def mock_get_features(tenant_id: str, exclude_vector_space: bool = False):
        return FeatureModel(can_replace_logo=True)

    monkeypatch.setattr(human_input_module.FeatureService, "get_features", mock_get_features)

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        response = HumanInputFormApi().get("token-1")

    body = response
    assert body["inputs"] == [input_config.model_dump(mode="json") for input_config in runtime_inputs]
    service_mock.resolve_form_inputs.assert_called_once_with(form)


def test_create_upload_token_returns_token_and_form_expiration(
    monkeypatch: pytest.MonkeyPatch, app: Flask, database_session: Session
) -> None:
    """POST returns a HITL upload token for an active form token."""

    expiration_time = datetime(2099, 1, 1, tzinfo=UTC)
    _, app_model, _ = _persist_app_site(database_session)
    form_service = _FormService(_FormRef(app_id=app_model.id, tenant_id=app_model.tenant_id))
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: form_service)
    service_mock = MagicMock()
    service_mock.issue_upload_token.return_value = SimpleNamespace(
        upload_token="hitl_upload_token-1",
        expires_at=expiration_time,
    )
    monkeypatch.setattr(
        human_input_module,
        "application_services",
        lambda: SimpleNamespace(human_input_file_uploads=service_mock),
    )

    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_UPLOAD_TOKEN_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")

    with app.test_request_context("/api/form/human_input/token-1/upload-token", method="POST"):
        result, status = HumanInputFormUploadTokenApi().post("token-1")

    assert status == 200
    assert result == {
        "upload_token": "hitl_upload_token-1",
        "expires_at": int(expiration_time.timestamp()),
    }
    service_mock.issue_upload_token.assert_called_once_with("token-1")
    limiter_mock.increment_rate_limit.assert_called_once_with("203.0.113.10")


def test_get_form_allows_backstage_token(monkeypatch: pytest.MonkeyPatch, app: Flask, database_session: Session):
    """GET returns form payload for backstage token."""

    expiration_time = datetime(2099, 1, 2, tzinfo=UTC)
    _, app_model, _ = _persist_app_site(database_session)

    class _FakeDefinition:
        def model_dump(self, mode: str | None = None):
            return {
                "form_content": "Raw content",
                "rendered_content": "Rendered",
                "inputs": [],
                "default_values": {},
                "user_actions": [],
            }

    class _FakeForm:
        def __init__(self, expiration: datetime):
            self.workflow_run_id = None
            self.app_id = app_model.id
            self.tenant_id = app_model.tenant_id
            self.expiration_time = expiration

        def get_definition(self):
            return _FakeDefinition()

    form = _FakeForm(expiration_time)
    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_ACCESS_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")
    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = form
    service_mock.resolve_form_inputs.return_value = []
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    monkeypatch.setattr(
        human_input_module.FeatureService,
        "get_features",
        lambda tenant_id, **_kwargs: FeatureModel(can_replace_logo=True, webapp_copyright_enabled=True),
    )

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        response = HumanInputFormApi().get("token-1")

    body = response
    assert set(body.keys()) == {
        "site",
        "form_content",
        "inputs",
        "resolved_default_values",
        "user_actions",
        "expiration_time",
    }
    assert body["form_content"] == "Rendered"
    assert body["inputs"] == []
    assert body["resolved_default_values"] == {}
    assert body["user_actions"] == []
    assert body["expiration_time"] == int(expiration_time.timestamp())
    assert body["site"] == {
        "app_id": app_model.id,
        "mode": "chat",
        "end_user_id": None,
        "enable_site": True,
        "site": {
            "title": "My Site",
            "chat_color_theme": "light",
            "chat_color_theme_inverted": False,
            "icon_type": "emoji",
            "icon": "robot",
            "icon_background": "#fff",
            "icon_url": None,
            "description": "desc",
            "copyright": None,
            "privacy_policy": None,
            "input_placeholder": "Ask the app",
            "custom_disclaimer": "",
            "default_language": "en",
            "prompt_public": False,
            "show_workflow_steps": True,
            "use_icon_as_answer_icon": False,
        },
        "model_config": None,
        "plan": "basic",
        "can_replace_logo": True,
        "custom_config": {
            "remove_webapp_brand": True,
            "replace_webapp_logo": None,
        },
    }
    service_mock.get_form_by_token.assert_called_once_with("token-1")
    limiter_mock.is_rate_limited.assert_called_once_with("203.0.113.10")
    limiter_mock.increment_rate_limit.assert_called_once_with("203.0.113.10")


def test_get_form_raises_forbidden_when_site_missing(
    monkeypatch: pytest.MonkeyPatch, app: Flask, database_session: Session
):
    """GET raises Forbidden if site cannot be resolved."""

    expiration_time = datetime(2099, 1, 3, tzinfo=UTC)
    _, app_model, _ = _persist_app_site(database_session, include_site=False)

    class _FakeDefinition:
        def model_dump(self, mode: str | None = None):
            return {
                "form_content": "Raw content",
                "rendered_content": "Rendered",
                "inputs": [],
                "default_values": {},
                "user_actions": [],
            }

    class _FakeForm:
        def __init__(self, expiration: datetime):
            self.workflow_run_id = None
            self.app_id = app_model.id
            self.tenant_id = app_model.tenant_id
            self.expiration_time = expiration

        def get_definition(self):
            return _FakeDefinition()

    form = _FakeForm(expiration_time)
    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_ACCESS_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")
    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = form
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        with pytest.raises(Forbidden):
            HumanInputFormApi().get("token-1")
    limiter_mock.is_rate_limited.assert_called_once_with("203.0.113.10")
    limiter_mock.increment_rate_limit.assert_called_once_with("203.0.113.10")


def test_get_form_raises_forbidden_when_tenant_archived(
    monkeypatch: pytest.MonkeyPatch, app: Flask, database_session: Session
) -> None:
    """GET raises Forbidden when the app's tenant is archived."""

    expiration_time = datetime(2099, 1, 3, tzinfo=UTC)
    tenant, app_model, _ = _persist_app_site(database_session)
    tenant.status = TenantStatus.ARCHIVE
    database_session.commit()

    class _FakeDefinition:
        def model_dump(self, mode: str | None = None) -> dict[str, object]:
            return {
                "form_content": "Raw content",
                "rendered_content": "Rendered",
                "inputs": [],
                "default_values": {},
                "user_actions": [],
            }

    class _FakeForm:
        def __init__(self, expiration: datetime) -> None:
            self.workflow_run_id: str | None = None
            self.app_id: str = app_model.id
            self.tenant_id: str = app_model.tenant_id
            self.expiration_time: datetime = expiration

        def get_definition(self) -> _FakeDefinition:
            return _FakeDefinition()

    form = _FakeForm(expiration_time)
    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_ACCESS_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")
    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = form
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        with pytest.raises(Forbidden):
            HumanInputFormApi().get("token-1")


def test_submit_form_accepts_backstage_token(monkeypatch: pytest.MonkeyPatch, app: Flask, database_session: Session):
    """POST forwards backstage submissions to the service."""

    _, app_model, _ = _persist_app_site(database_session)
    form = _FormRef(app_id=app_model.id, tenant_id=app_model.tenant_id, recipient_type=RecipientType.BACKSTAGE)
    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_SUBMIT_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")
    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = form
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    with app.test_request_context(
        "/api/form/human_input/token-1",
        method="POST",
        json={"inputs": {"content": "ok"}, "action": "approve"},
    ):
        response, status = HumanInputFormApi().post("token-1")

    assert status == 200
    assert response == {}
    service_mock.ensure_form_active.assert_called_once_with(form)
    service_mock.submit_form_by_token.assert_called_once_with(
        recipient_type=RecipientType.BACKSTAGE,
        form_token="token-1",
        selected_action_id="approve",
        form_data={"content": "ok"},
        submission_end_user_id=None,
    )
    limiter_mock.is_rate_limited.assert_called_once_with("203.0.113.10")
    limiter_mock.increment_rate_limit.assert_called_once_with("203.0.113.10")


def test_submit_form_rate_limited(monkeypatch: pytest.MonkeyPatch, app: Flask):
    """POST rejects submissions when rate limit is exceeded."""

    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = True
    monkeypatch.setattr(human_input_module, "_FORM_SUBMIT_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")

    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = None
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    with app.test_request_context(
        "/api/form/human_input/token-1",
        method="POST",
        json={"inputs": {"content": "ok"}, "action": "approve"},
    ):
        with pytest.raises(WebFormRateLimitExceededError):
            HumanInputFormApi().post("token-1")

    limiter_mock.is_rate_limited.assert_called_once_with("203.0.113.10")
    limiter_mock.increment_rate_limit.assert_not_called()
    service_mock.get_form_by_token.assert_not_called()


def test_get_form_rate_limited(monkeypatch: pytest.MonkeyPatch, app: Flask):
    """GET rejects requests when rate limit is exceeded."""

    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = True
    monkeypatch.setattr(human_input_module, "_FORM_ACCESS_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")

    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = None
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        with pytest.raises(WebFormRateLimitExceededError):
            HumanInputFormApi().get("token-1")

    limiter_mock.is_rate_limited.assert_called_once_with("203.0.113.10")
    limiter_mock.increment_rate_limit.assert_not_called()
    service_mock.get_form_by_token.assert_not_called()


def test_get_form_raises_expired(monkeypatch: pytest.MonkeyPatch, app: Flask, sqlite_engine: Engine):
    class _FakeForm:
        pass

    form = _FakeForm()
    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_ACCESS_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")
    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = form
    service_mock.ensure_form_active.side_effect = FormExpiredError("form-id")
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)
    monkeypatch.setattr(human_input_module, "db", SimpleNamespace(engine=sqlite_engine))

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        with pytest.raises(FormExpiredError):
            HumanInputFormApi().get("token-1")

    service_mock.ensure_form_active.assert_called_once_with(form)
    limiter_mock.is_rate_limited.assert_called_once_with("203.0.113.10")
    limiter_mock.increment_rate_limit.assert_called_once_with("203.0.113.10")


# The form page (GET), the submit (POST), and the upload-token endpoint must give
# the same answer for one token. Each case below makes the form app unavailable.
_UNAVAILABLE_APP_CASES = [
    pytest.param("archived", Forbidden, id="workspace-archived"),
    pytest.param("site_missing", Forbidden, id="site-missing"),
    pytest.param("app_deleted", NotFoundError, id="app-deleted"),
    pytest.param("other_tenant", NotFoundError, id="app-in-other-workspace"),
]


class _FormRef:
    """The stored form fields that the web form endpoints read."""

    def __init__(
        self,
        *,
        app_id: str,
        tenant_id: str,
        recipient_type: RecipientType = RecipientType.STANDALONE_WEB_APP,
    ) -> None:
        self.id = "form-1"
        self.app_id = app_id
        self.tenant_id = tenant_id
        self.recipient_type = recipient_type
        self.expiration_time = datetime(2099, 1, 1, tzinfo=UTC)


class _FormService:
    """A form service that returns one form and records what the endpoint did with it."""

    def __init__(self, form: _FormRef | None, *, active_error: Exception | None = None) -> None:
        self.form = form
        self.active_error = active_error
        self.resolved_inputs = 0
        self.submissions: list[dict[str, object]] = []

    def get_form_by_token(self, _form_token: str) -> _FormRef | None:
        return self.form

    def ensure_form_active(self, _form: _FormRef) -> None:
        if self.active_error is not None:
            raise self.active_error

    def resolve_form_inputs(self, _form: _FormRef) -> list[object]:
        self.resolved_inputs += 1
        return []

    def submit_form_by_token(self, **kwargs: object) -> None:
        self.submissions.append(kwargs)


class _UploadTokens:
    """An upload service that records each upload token request."""

    def __init__(self) -> None:
        self.issued: list[str] = []

    def issue_upload_token(self, form_token: str) -> None:
        self.issued.append(form_token)


@dataclass
class _ApplicationServices:
    human_input_file_uploads: _UploadTokens


class _OpenRateLimiter:
    def is_rate_limited(self, _ip_address: str) -> bool:
        return False

    def increment_rate_limit(self, _ip_address: str) -> None:
        return None


def _unavailable_form(session: Session, case: str) -> _FormRef:
    tenant, app_model, _ = _persist_app_site(session, include_site=case != "site_missing")
    app_id = app_model.id
    tenant_id = app_model.tenant_id
    if case == "archived":
        tenant.status = TenantStatus.ARCHIVE
        session.commit()
    elif case == "app_deleted":
        app_id = str(uuid4())
    elif case == "other_tenant":
        tenant_id = str(uuid4())
    return _FormRef(app_id=app_id, tenant_id=tenant_id)


def _allow_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("_FORM_ACCESS_RATE_LIMITER", "_FORM_SUBMIT_RATE_LIMITER", "_FORM_UPLOAD_TOKEN_RATE_LIMITER"):
        monkeypatch.setattr(human_input_module, name, _OpenRateLimiter())
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")


def _patch_form_service(monkeypatch: pytest.MonkeyPatch, service: _FormService) -> _FormService:
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service)
    return service


def _patch_upload_tokens(monkeypatch: pytest.MonkeyPatch) -> _UploadTokens:
    uploads = _UploadTokens()
    monkeypatch.setattr(human_input_module, "application_services", lambda: _ApplicationServices(uploads))
    return uploads


def _submit(app: Flask) -> None:
    with app.test_request_context(
        "/api/form/human_input/token-1",
        method="POST",
        json={"inputs": {}, "action": "approve"},
    ):
        HumanInputFormApi().post("token-1")


def _get(app: Flask) -> None:
    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        HumanInputFormApi().get("token-1")


def _issue_upload_token(app: Flask) -> None:
    with app.test_request_context("/api/form/human_input/token-1/upload-token", method="POST"):
        HumanInputFormUploadTokenApi().post("token-1")


@pytest.mark.parametrize(("case", "expected_error"), _UNAVAILABLE_APP_CASES)
def test_get_form_rejects_unavailable_app(
    monkeypatch: pytest.MonkeyPatch, app: Flask, database_session: Session, case: str, expected_error: type
) -> None:
    _allow_requests(monkeypatch)
    service = _patch_form_service(monkeypatch, _FormService(_unavailable_form(database_session, case)))

    with pytest.raises(expected_error):
        _get(app)

    assert service.resolved_inputs == 0


@pytest.mark.parametrize(("case", "expected_error"), _UNAVAILABLE_APP_CASES)
def test_submit_form_rejects_unavailable_app(
    monkeypatch: pytest.MonkeyPatch, app: Flask, database_session: Session, case: str, expected_error: type
) -> None:
    _allow_requests(monkeypatch)
    service = _patch_form_service(monkeypatch, _FormService(_unavailable_form(database_session, case)))

    with pytest.raises(expected_error):
        _submit(app)

    # The form must stay waiting, so the workflow run does not resume.
    assert service.submissions == []


@pytest.mark.parametrize(("case", "expected_error"), _UNAVAILABLE_APP_CASES)
def test_upload_token_rejects_unavailable_app(
    monkeypatch: pytest.MonkeyPatch, app: Flask, database_session: Session, case: str, expected_error: type
) -> None:
    _allow_requests(monkeypatch)
    _patch_form_service(monkeypatch, _FormService(_unavailable_form(database_session, case)))
    uploads = _patch_upload_tokens(monkeypatch)

    with pytest.raises(expected_error):
        _issue_upload_token(app)

    assert uploads.issued == []


@pytest.mark.parametrize("call", [_get, _submit, _issue_upload_token], ids=["get", "submit", "upload-token"])
def test_expired_form_reports_expired_before_app_checks(
    monkeypatch: pytest.MonkeyPatch, app: Flask, database_session: Session, call: Callable[[Flask], None]
) -> None:
    # An expired form in an archived workspace returns 412 from every endpoint,
    # the same as the form page did before this check was shared.
    _allow_requests(monkeypatch)
    service = _patch_form_service(
        monkeypatch,
        _FormService(_unavailable_form(database_session, "archived"), active_error=FormExpiredError("form-1")),
    )
    uploads = _patch_upload_tokens(monkeypatch)

    with pytest.raises(FormExpiredError):
        call(app)

    assert service.submissions == []
    assert uploads.issued == []


def test_upload_token_returns_not_found_for_unknown_token(
    monkeypatch: pytest.MonkeyPatch, app: Flask, database_session: Session
) -> None:
    _allow_requests(monkeypatch)
    _patch_form_service(monkeypatch, _FormService(None))
    uploads = _patch_upload_tokens(monkeypatch)

    with pytest.raises(NotFoundError):
        _issue_upload_token(app)

    assert uploads.issued == []
