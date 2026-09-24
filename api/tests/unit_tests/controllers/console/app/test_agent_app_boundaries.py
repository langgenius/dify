"""Console admission and transport contracts for Agent App features and references."""

from dataclasses import dataclass, field
from inspect import unwrap
from uuid import UUID

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

from controllers.console import flask_admission
from controllers.console.app import advanced_prompt_template, agent_app_access, agent_app_feature
from libs.login import AccountWithTenant
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.agent.errors import AgentNotFoundError
from services.app.advanced_prompt_template_service import AdvancedPromptTemplateService
from services.app.agent_app_contracts import AgentAppNotFoundError, AgentReferencingWorkflow
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.controllers.rbac_introspection import rbac_checks
from tests.unit_tests.model_factories import make_account

CONTEXT = RequestContext("request", None, "actor", "tenant")
AGENT_ID = UUID("11111111-1111-1111-1111-111111111111")


@dataclass
class FeatureService:
    calls: list[tuple[RequestContext, str, dict[str, object]]] = field(default_factory=list)

    def update_features(self, context: RequestContext, agent_id: str, config: dict[str, object]) -> None:
        self.calls.append((context, agent_id, config))


@dataclass
class AccessService:
    calls: list[tuple[RequestContext, str]] = field(default_factory=list)
    missing: bool = False

    def list_referencing_workflows(self, context: RequestContext, agent_id: str) -> list[AgentReferencingWorkflow]:
        self.calls.append((context, agent_id))
        if self.missing:
            raise AgentAppNotFoundError
        return [
            AgentReferencingWorkflow(
                app_id="workflow-app",
                app_name="Workflow",
                app_mode="workflow",
                app_icon_type=None,
                app_icon=None,
                app_icon_background=None,
                app_updated_at=123,
                workflow_id="workflow",
                workflow_version="published",
                node_ids=["node"],
            )
        ]


@dataclass
class AgentServices:
    features: FeatureService = field(default_factory=FeatureService)
    access: AccessService = field(default_factory=AccessService)


@dataclass
class Services:
    agent_apps: AgentServices = field(default_factory=AgentServices)
    advanced_prompt_templates: AdvancedPromptTemplateService = field(default_factory=AdvancedPromptTemplateService)


@pytest.fixture
def services(monkeypatch: pytest.MonkeyPatch) -> Services:
    services = Services()
    for module in (agent_app_feature, agent_app_access, advanced_prompt_template):
        monkeypatch.setattr(module, "application_services", lambda: services)
    return services


def test_features_parse_full_state_and_drop_soul_fields(app: Flask, services: Services) -> None:
    with app.test_request_context(
        "/", method="POST", json={"opening_statement": "Hi", "speech_to_text": None, "model": {"name": "x"}}
    ):
        result = unwrap(agent_app_feature.AgentAppFeatureConfigResource.post)(object(), CONTEXT, AGENT_ID)
    assert result == {"result": "success"}
    assert services.agent_apps.features.calls == [(CONTEXT, str(AGENT_ID), {"opening_statement": "Hi"})]


@pytest.mark.parametrize("role", list(TenantAccountRole))
def test_feature_admission_enforces_editing_roles(
    app: Flask, services: Services, monkeypatch: pytest.MonkeyPatch, role: TenantAccountRole
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    account = make_account(account_id="actor", name="Editor", email="editor@example.com", role=role)
    monkeypatch.setattr(flask_admission, "current_account_with_tenant", lambda: AccountWithTenant(account, "tenant"))
    monkeypatch.setattr(flask_admission, "get_request_id", lambda: "request")
    monkeypatch.setattr(flask_admission, "get_trace_id", lambda: None)
    # Exercise the declared admission policy after setup/login/initialization.
    view = agent_app_feature.AgentAppFeatureConfigResource.post
    while hasattr(view.__wrapped__, "__wrapped__"):
        view = view.__wrapped__
    with app.test_request_context("/", method="POST", json={}):
        if role in (TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR):
            assert view(object(), agent_id=AGENT_ID) == {"result": "success"}
            assert services.agent_apps.features.calls == [(CONTEXT, str(AGENT_ID), {})]
        else:
            with pytest.raises(Forbidden):
                view(object(), agent_id=AGENT_ID)
            assert services.agent_apps.features.calls == []


def test_agent_endpoints_keep_rbac_scenes() -> None:
    for view, scene in (
        (agent_app_feature.AgentAppFeatureConfigResource.post, agent_app_feature.RBACPermission.AGENT_EDIT),
        (agent_app_access.AgentAppReferencingWorkflowsResource.get, agent_app_access.RBACPermission.AGENT_PREVIEW),
    ):
        [check] = rbac_checks(view)
        assert isinstance(check.locator, agent_app_access.AgentId)
        assert check.scene == scene


def test_access_serializes_workflow_metadata(services: Services) -> None:
    result = unwrap(agent_app_access.AgentAppReferencingWorkflowsResource.get)(object(), CONTEXT, AGENT_ID)
    assert services.agent_apps.access.calls == [(CONTEXT, str(AGENT_ID))]
    assert result["data"][0]["node_ids"] == ["node"]
    assert result["data"][0]["app_updated_at"] == 123
    services.agent_apps.access.missing = True
    with pytest.raises(AgentNotFoundError):
        unwrap(agent_app_access.AgentAppReferencingWorkflowsResource.get)(object(), CONTEXT, AGENT_ID)


@pytest.mark.parametrize("app_mode", ["chat", "completion", "invalid"])
@pytest.mark.usefixtures("services")
def test_prompt_response_preserves_omitted_fields(app: Flask, app_mode: str) -> None:
    with app.test_request_context("/", query_string={"app_mode": app_mode, "model_mode": "chat", "model_name": "gpt"}):
        result = unwrap(advanced_prompt_template.AdvancedPromptTemplateList.get)(object(), CONTEXT)
    if app_mode == "invalid":
        assert result == {}
    else:
        assert set(result) == {"chat_prompt_config"}
