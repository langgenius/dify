"""Policy wire schemas, registered routes, admission and error mapping."""

from inspect import unwrap

import pytest
from flask import Flask
from pydantic import ValidationError
from werkzeug.exceptions import Forbidden

from controllers.console import dify_builder_policy as controller
from controllers.console.dify_builder_policy_fields import DifyBuilderPolicyPayload, DifyBuilderPolicyResponse
from core.dify_builder.models import Actor
from machinery.context import RequestContext
from services.dify_builder.application.cognition_policy import CognitionPolicyDeniedError

PAYLOAD: dict[str, object] = {
    "expected_revision": 0,
    "enabled": True,
    "models": [{"id": "one", "provider": "openai", "name": "gpt", "mode": "chat", "completion_params": {}}],
    "default_model_id": "one",
    "fallback_model_ids": [],
}
CONTEXT = RequestContext(account_id="account", active_workspace_id="workspace", request_id="request", trace_id=None)


@pytest.mark.parametrize(
    "change",
    [
        {"expected_revision": True},
        {"api_key": "secret"},
        {
            "models": [
                {
                    "id": "one",
                    "provider": "p",
                    "name": "m",
                    "mode": "chat",
                    "completion_params": {"base_url": "https://remote"},
                }
            ]
        },
    ],
)
def test_policy_rejects_revision_coercion_and_secret_transport_fields(change: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        DifyBuilderPolicyPayload.model_validate({**PAYLOAD, **change})


def test_policy_response_emits_inherited_source_and_safe_models() -> None:
    model = DifyBuilderPolicyPayload.model_validate(PAYLOAD).policy()
    response = DifyBuilderPolicyResponse.model_validate(
        {
            "enabled": model.enabled,
            "models": [
                {
                    **{"id": "one", "provider": "openai", "name": "gpt", "mode": "chat", "completion_params": {}},
                    "health": "configured",
                }
            ],
            "default_model_id": "one",
            "fallback_model_ids": [],
            "revision": 0,
            "source": "workspace_default",
            "available": True,
            "reason_code": None,
        }
    )
    assert response.model_dump()["source"] == "workspace_default"
    assert "credential" not in response.model_dump_json()


def test_admin_policy_denial_is_forbidden_and_conflict_has_409() -> None:
    with pytest.raises(Forbidden):
        controller._raise_policy_error(CognitionPolicyDeniedError("policy_permission_denied"))
    with pytest.raises(controller.BuilderPolicyConflictError) as error:
        controller._raise_policy_error(CognitionPolicyDeniedError("policy_revision_conflict"))
    assert error.value.code == 409


def test_get_admits_actor_then_reads_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[Actor] = []

    class Service:
        def availability(self, actor: Actor, *, admin: bool) -> None:
            assert admin
            calls.append(actor)

    service = Service()
    monkeypatch.setattr(controller, "build_cognition_policy_service", lambda: service)
    monkeypatch.setattr(
        controller,
        "policy_projection",
        lambda _status: {
            "enabled": True,
            "models": [],
            "default_model_id": None,
            "fallback_model_ids": [],
            "source": "workspace_default",
            "revision": 0,
            "available": False,
            "reason_code": "model_unavailable",
        },
    )
    with Flask(__name__).test_request_context():
        body, status = unwrap(controller.DifyBuilderPolicyApi.get)(controller.DifyBuilderPolicyApi(), CONTEXT)
    assert status == 200
    assert calls == [Actor(tenant_id="workspace", account_id="account")]
    assert body["revision"] == 0


@pytest.mark.parametrize("operation", ["get", "put"])
@pytest.mark.parametrize("reason", ["model_unavailable", "model_availability_unknown"])
def test_admin_policy_routes_serialize_missing_and_unknown_default_status(
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
    reason: str,
) -> None:
    from services.dify_builder.application.cognition_policy import CognitionPolicy, CognitionPolicyStatus

    policy = CognitionPolicy(True, (), None, (), 0, "workspace_default")
    status = CognitionPolicyStatus(policy, {}, False, reason)

    class Service:
        def availability(self, actor: Actor, *, admin: bool) -> CognitionPolicyStatus:
            assert actor == Actor(tenant_id="workspace", account_id="account")
            assert admin
            return status

        def put_status(
            self, actor: Actor, proposed: CognitionPolicy, *, expected_revision: int
        ) -> CognitionPolicyStatus:
            assert actor == Actor(tenant_id="workspace", account_id="account")
            assert expected_revision == 0
            assert proposed.enabled
            return status

    monkeypatch.setattr(controller, "build_cognition_policy_service", lambda: Service())
    with Flask(__name__).test_request_context(json=PAYLOAD):
        method = controller.DifyBuilderPolicyApi.get if operation == "get" else controller.DifyBuilderPolicyApi.put
        body, code = unwrap(method)(controller.DifyBuilderPolicyApi(), CONTEXT)
    assert code == 200
    assert body["available"] is False
    assert body["reason_code"] == reason
    assert body["source"] == "workspace_default"
    assert body["revision"] == 0
