"""Workspace-owned Builder cognition policy, separate from Workflow-node models.

The repository serializes writes against the tenant and rechecks administrator
membership in that same transaction. Native model metadata is read outside it.
Fallback is permitted only for local unavailability before an invocation starts.
"""

import math
import re
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from core.dify_builder.models import Actor


class CognitionPolicyDeniedError(Exception):
    """Actionable policy refusal; cognition must never convert it to heuristics."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


@dataclass(frozen=True)
class CognitionModel:
    id: str
    provider: str
    name: str
    mode: str
    completion_params: dict[str, Any]

    def __post_init__(self):
        if not all(isinstance(value, str) and 0 < len(value) <= 255 for value in (self.id, self.provider, self.name)):
            raise ValueError("invalid model reference")
        if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./-]*", self.provider) is None or "://" in self.name:
            raise ValueError("invalid native model reference")
        if self.mode not in {"chat", "completion"}:
            raise ValueError("invalid model mode")
        # Native normal generation controls only. Never persist credentials,
        # arbitrary extension parameters, provider URLs or transport options.
        numeric = {
            "temperature",
            "top_p",
            "top_k",
            "max_tokens",
            "max_completion_tokens",
            "presence_penalty",
            "frequency_penalty",
            "seed",
        }
        if len(self.completion_params) > 12:
            raise ValueError("invalid completion parameters")
        for key, value in self.completion_params.items():
            if key in numeric:
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                    raise ValueError("invalid completion parameters")
            elif key == "stop":
                if (
                    not isinstance(value, list)
                    or len(value) > 8
                    or any(not isinstance(x, str) or len(x) > 256 for x in value)
                ):
                    raise ValueError("invalid completion parameters")
            else:
                raise ValueError("invalid completion parameters")

    def config(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "name": self.name,
            "mode": self.mode,
            "completion_params": dict(self.completion_params),
        }


@dataclass(frozen=True)
class CognitionPolicy:
    enabled: bool
    models: tuple[CognitionModel, ...]
    # None means no model is selected, allowed only while disabled/unavailable.
    default_model_id: str | None
    fallback_model_ids: tuple[str, ...]
    revision: int
    source: Literal["explicit", "workspace_default"]


@dataclass(frozen=True)
class CognitionPolicyStatus:
    policy: CognitionPolicy
    health: dict[str, Literal["configured", "unavailable", "unknown"]]
    available: bool
    reason_code: str | None


class CognitionPolicyRepository(Protocol):
    def require_member(self, actor: Actor, *, admin: bool) -> None: ...

    def get_policy(self, actor: Actor) -> CognitionPolicy | None:
        """Read tenant current row; None is inherited Workspace default policy."""
        ...

    def put_policy(self, actor: Actor, policy: CognitionPolicy, expected_revision: int) -> CognitionPolicy:
        """Lock tenant, lock/recheck owner/admin membership, CAS current revision.

        First writes also lock the tenant; concurrent expected_revision=0 writes
        cannot both create a policy. External I/O is forbidden inside this write.
        """
        ...


class CognitionModelGateway(Protocol):
    def workspace_default(self, actor: Actor) -> CognitionModel | None: ...

    def available(self, actor: Actor, model: CognitionModel) -> bool:
        """Check native active model and the actual selected credential chain.

        False means locally known unavailable. Unknown/error must propagate and
        may not authorize a fallback. Never perform a completion/health ping.
        """
        ...


class CognitionPolicyService:
    def __init__(self, repository: CognitionPolicyRepository, models: CognitionModelGateway):
        self._repository = repository
        self._models = models

    def _current(self, actor: Actor) -> CognitionPolicy:
        self._repository.require_member(actor, admin=False)
        policy = self._repository.get_policy(actor)
        if policy is not None:
            return policy
        model = self._models.workspace_default(actor)
        return CognitionPolicy(True, (model,) if model else (), model.id if model else None, (), 0, "workspace_default")

    def get(self, actor: Actor) -> CognitionPolicy:
        self._repository.require_member(actor, admin=True)
        return self._current(actor)

    def put(self, actor: Actor, policy: CognitionPolicy, *, expected_revision: int) -> CognitionPolicy:
        self._repository.require_member(actor, admin=True)
        ids = [model.id for model in policy.models]
        if len(ids) != len(set(ids)) or len(ids) > 20:
            raise ValueError("model identifiers must be unique and bounded")
        if policy.default_model_id is not None and policy.default_model_id not in ids:
            raise ValueError("default model must be configured")
        if policy.enabled and policy.default_model_id is None:
            raise ValueError("enabled policy requires a default model")
        if len(policy.fallback_model_ids) != len(set(policy.fallback_model_ids)) or any(
            x not in ids or x == policy.default_model_id for x in policy.fallback_model_ids
        ):
            raise ValueError("fallback models must be distinct configured models")
        return self._repository.put_policy(actor, policy, expected_revision)

    def select(self, actor: Actor, requested: dict[str, Any] | None) -> CognitionModel:
        policy = self._current(actor)
        if not policy.enabled:
            raise CognitionPolicyDeniedError("builder_disabled")
        by_id = {model.id: model for model in policy.models}
        selected = by_id.get(policy.default_model_id or "")
        if requested:
            selected = next((model for model in policy.models if model.config() == requested), None)
            if selected is None:
                raise CognitionPolicyDeniedError("model_not_allowed")
        choices = ([selected] if selected else []) + [
            by_id[x] for x in policy.fallback_model_ids if selected is None or x != selected.id
        ]
        for model in choices:
            if self._models.available(actor, model):
                return model
        raise CognitionPolicyDeniedError("model_unavailable")

    def authorize_selected(self, actor: Actor, selected: CognitionModel) -> None:
        """Fresh policy check after external metadata and before dispatch.

        This does not choose a fallback or perform an inference. A selected
        fallback must still be an exact currently configured choice.
        """
        policy = self._current(actor)
        if not policy.enabled:
            raise CognitionPolicyDeniedError("builder_disabled")
        if not any(model.config() == selected.config() for model in policy.models):
            raise CognitionPolicyDeniedError("model_not_allowed")

    def availability(self, actor: Actor, *, admin: bool = False) -> CognitionPolicyStatus:
        self._repository.require_member(actor, admin=admin)
        try:
            policy = self._current(actor)
        except CognitionPolicyDeniedError as error:
            if error.reason != "model_availability_unknown":
                raise
            policy = CognitionPolicy(True, (), None, (), 0, "workspace_default")
            return CognitionPolicyStatus(policy, {}, False, "model_availability_unknown")
        except Exception:
            policy = CognitionPolicy(True, (), None, (), 0, "workspace_default")
            return CognitionPolicyStatus(policy, {}, False, "model_availability_unknown")
        return self._status(actor, policy)

    def put_status(self, actor: Actor, policy: CognitionPolicy, *, expected_revision: int) -> CognitionPolicyStatus:
        saved = self.put(actor, policy, expected_revision=expected_revision)
        return self._status(actor, saved)

    def _status(self, actor: Actor, policy: CognitionPolicy) -> CognitionPolicyStatus:
        health: dict[str, Literal["configured", "unavailable", "unknown"]] = {}
        for model in policy.models:
            try:
                health[model.id] = "configured" if self._models.available(actor, model) else "unavailable"
            except Exception:
                health[model.id] = "unknown"
        if not policy.enabled:
            return CognitionPolicyStatus(policy, health, False, "builder_disabled")
        for model_id in (policy.default_model_id, *policy.fallback_model_ids):
            state = health.get(model_id or "", "unavailable")
            if state == "configured":
                return CognitionPolicyStatus(policy, health, True, None)
            if state == "unknown":
                return CognitionPolicyStatus(policy, health, False, "model_availability_unknown")
        return CognitionPolicyStatus(policy, health, False, "model_unavailable")


# These commands use existing native execution/control owners. They may read
# history or settle/stop a run while Builder cognition is disabled. Any model
# invocation reached from one still passes the invocation guard.
_NATIVE_CONTROL_ACTIONS = frozenset(
    {
        "stop",
        "resume",
        "task_continue",
        "run_test",
        "run_verify",
        "provide_testdata",
        "run_affected_tests",
        "publish",
        "publish_workflow",
        "undo",
        "keep_draft",
        "test_start",
        "test_retry",
        "test_continue",
        "test_cancel",
        "test_skip",
        "confirmed_tool_execution",
        "check_recovery",
    }
)


def cognition_admission_required(kind: str) -> bool:
    return kind not in _NATIVE_CONTROL_ACTIONS
