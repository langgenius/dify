"""Workspace cognition rules with in-memory consumer-owned ports."""

from dataclasses import replace

import pytest

from core.dify_builder.models import Actor
from services.dify_builder.application.cognition_policy import (
    CognitionModel,
    CognitionPolicy,
    CognitionPolicyDeniedError,
    CognitionPolicyService,
)

MODEL = CognitionModel("primary", "openai", "gpt", "chat", {"temperature": 0.2})
OTHER = CognitionModel("fallback", "openai", "other", "chat", {})
ACTOR = Actor(tenant_id="tenant", account_id="member")


class Policies:
    policy: CognitionPolicy | None = None
    role = "admin"

    def get_policy(self, actor: Actor) -> CognitionPolicy | None:
        assert actor.tenant_id == "tenant"
        return self.policy

    def require_member(self, actor: Actor, *, admin: bool) -> None:
        assert actor.tenant_id == "tenant"
        if self.role is None or (admin and self.role not in {"admin", "owner"}):
            raise CognitionPolicyDeniedError("policy_permission_denied")

    def put_policy(self, actor: Actor, policy: CognitionPolicy, expected_revision: int) -> CognitionPolicy:
        self.require_member(actor, admin=True)
        revision = self.policy.revision if self.policy else 0
        if expected_revision != revision:
            raise CognitionPolicyDeniedError("policy_revision_conflict")
        self.policy = replace(policy, revision=revision + 1, source="explicit")
        return self.policy


class Models:
    unavailable: set[str] = set()
    inspections: list[str]

    def __init__(self) -> None:
        self.inspections = []

    def workspace_default(self, actor: Actor) -> CognitionModel:
        assert actor.tenant_id == "tenant"
        return MODEL

    def available(self, actor: Actor, model: CognitionModel) -> bool:
        assert actor.tenant_id == "tenant"
        self.inspections.append(model.id)
        return model.id not in self.unavailable


type Subject = tuple[CognitionPolicyService, Policies, Models]


@pytest.fixture
def subject() -> Subject:
    policies, models = Policies(), Models()
    return CognitionPolicyService(policies, models), policies, models


def test_absent_policy_inherits_only_native_workspace_default(subject: Subject) -> None:
    service, _, _ = subject
    policy = service.get(ACTOR)
    assert policy.source == "workspace_default"
    assert policy.revision == 0
    assert policy.enabled
    assert policy.models == (MODEL,)
    assert service.select(ACTOR, None) == MODEL
    with pytest.raises(CognitionPolicyDeniedError, match="model_not_allowed"):
        service.select(ACTOR, OTHER.config())


def test_exact_parameters_and_enabled_configuration_are_required(subject: Subject) -> None:
    service, policies, _ = subject
    policies.policy = CognitionPolicy(True, (MODEL,), "primary", (), 2, "explicit")
    assert service.select(ACTOR, MODEL.config()) == MODEL
    with pytest.raises(CognitionPolicyDeniedError, match="model_not_allowed"):
        service.select(ACTOR, {**MODEL.config(), "completion_params": {"temperature": 1}})
    policies.policy = replace(policies.policy, enabled=False)
    with pytest.raises(CognitionPolicyDeniedError, match="builder_disabled"):
        service.select(ACTOR, MODEL.config())


def test_only_locally_unavailable_models_use_configured_fallback(subject: Subject) -> None:
    service, policies, models = subject
    policies.policy = CognitionPolicy(True, (MODEL, OTHER), "primary", ("fallback",), 1, "explicit")
    models.unavailable = {"primary"}
    assert service.select(ACTOR, None) == OTHER
    assert models.inspections == ["primary", "fallback"]
    models.unavailable = {"primary", "fallback"}
    with pytest.raises(CognitionPolicyDeniedError, match="model_unavailable"):
        service.select(ACTOR, None)


def test_policy_admin_admission_and_revision_are_owned_by_repository(subject: Subject) -> None:
    service, policies, _ = subject
    proposed = CognitionPolicy(True, (MODEL,), "primary", (), 0, "explicit")
    assert service.put(ACTOR, proposed, expected_revision=0).revision == 1
    with pytest.raises(CognitionPolicyDeniedError, match="policy_revision_conflict"):
        service.put(ACTOR, proposed, expected_revision=0)
    policies.role = "normal"
    with pytest.raises(CognitionPolicyDeniedError, match="policy_permission_denied"):
        service.put(ACTOR, proposed, expected_revision=1)
    with pytest.raises(CognitionPolicyDeniedError, match="policy_permission_denied"):
        service.get(ACTOR)
    assert service.select(ACTOR, None) == MODEL


def test_configuration_rejects_secret_fields_and_unconfigured_fallback(subject: Subject) -> None:
    service, _, _ = subject
    with pytest.raises(ValueError, match="completion"):
        CognitionModel("x", "provider", "model", "chat", {"api_key": "secret"})
    with pytest.raises(ValueError, match="fallback"):
        service.put(ACTOR, CognitionPolicy(True, (MODEL,), "primary", ("missing",), 0, "explicit"), expected_revision=0)


def test_unknown_primary_metadata_does_not_claim_available_fallback(subject: Subject) -> None:
    service, policies, models = subject
    policies.policy = CognitionPolicy(True, (MODEL, OTHER), "primary", ("fallback",), 1, "explicit")

    def uncertain(actor: Actor, model: CognitionModel) -> bool:
        assert actor == ACTOR
        if model.id == "primary":
            raise RuntimeError("metadata unavailable")
        return True

    models.available = uncertain
    status = service.availability(ACTOR)
    assert status.health == {"primary": "unknown", "fallback": "configured"}
    assert not status.available
    assert status.reason_code == "model_availability_unknown"


def test_model_selected_before_metadata_does_not_keep_revoked_admission(subject: Subject) -> None:
    service, policies, _ = subject
    selected = service.select(ACTOR, None)
    policies.policy = CognitionPolicy(False, (), None, (), 1, "explicit")
    with pytest.raises(CognitionPolicyDeniedError, match="builder_disabled"):
        service.authorize_selected(ACTOR, selected)


def test_native_recovery_continue_does_not_require_cognition_admission() -> None:
    from services.dify_builder.application.cognition_policy import cognition_admission_required

    assert not cognition_admission_required("recovery_continue")
    assert cognition_admission_required("recovery_restart")
    assert cognition_admission_required("send_edit_goal")


def test_recovery_continue_reentering_cognition_still_checks_disabled_policy(subject: Subject) -> None:
    from datetime import datetime
    from typing import Never

    from core.dify_builder.models import Action, DifyBuilderContext, EntryMode, Session, Turn
    from core.dify_builder.state import PcState
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent
    from services.dify_builder.application.handlers_edit import edit_registry
    from services.dify_builder.application.runner import Env, Runner
    from services.dify_builder.cognition_model_gateway import PolicyModelInstance
    from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository

    policy, policies, models = subject
    policies.policy = CognitionPolicy(False, (), None, (), 1, "explicit")
    selections: list[str] = []

    def resolve() -> Never:
        selections.append("recovery-model-invocation")
        policy.select(ACTOR, None)
        raise AssertionError("disabled cognition policy admitted a model")

    repo, dify = InMemoryRepository(), FakeDifyPort()
    session = Session(
        app_id="app",
        tenant_id=ACTOR.tenant_id,
        owner_account_id=ACTOR.account_id,
        entry_mode=EntryMode.EDIT,
        current_state=PcState.EDIT_CAPABILITY_CHECK,
    )
    context = DifyBuilderContext(goal_text="Make the response formal", last_snapshot_hash=dify.hash)
    repo.create_session(session, context, [])
    agent = LlmBuilderAgent(ACTOR.tenant_id, model_resolver_fn=lambda: PolicyModelInstance(resolve))
    runner = Runner(Env(dify=dify, agent=agent, repo=repo, now=lambda: datetime.min), edit_registry())

    # Recovery at the Edit entry synthesizes send_edit_goal and reaches the real
    # cognition helper. The invocation proxy must refuse before any provider I/O.
    with pytest.raises(CognitionPolicyDeniedError, match="builder_disabled"):
        runner.advance(
            session.id, Turn(actor=ACTOR, action=Action(kind="recovery_continue", base_version=session.version))
        )
    assert selections == ["recovery-model-invocation"]
    assert models.inspections == []
    assert dify.applied == []
