import pytest

from machinery.context import AppRequestContext
from services.moderation_service import (
    ModerationPhase,
    ModerationRejectedError,
    ModerationReplacement,
    ModerationRequest,
    ModerationRule,
    ModerationService,
    ModerationVerdict,
)


class RecordingModerationGateway:
    def __init__(self, verdict: ModerationVerdict) -> None:
        self.verdict = verdict
        self.calls: list[tuple[AppRequestContext, ModerationRule, str, ModerationPhase]] = []

    def check(
        self, context: AppRequestContext, *, rule: ModerationRule, request: ModerationRequest, phase: ModerationPhase
    ) -> ModerationVerdict:
        self.calls.append((context, rule, request.text, phase))
        return self.verdict


@pytest.mark.parametrize("phase", ["input", "output"])
@pytest.mark.parametrize("flagged", [True, False])
def test_strict_checks_preserve_scope_and_raise_on_rejection(phase: ModerationPhase, flagged: bool) -> None:
    context = AppRequestContext(tenant_id="tenant-1", app_id="app-1")
    rule = ModerationRule(type="api", config={"inputs_config": {"enabled": True}, "outputs_config": {"enabled": True}})
    gateway = RecordingModerationGateway(ModerationVerdict(flagged=flagged, message="Blocked"))
    service = ModerationService(gateway=gateway)

    if flagged:
        with pytest.raises(ModerationRejectedError, match="Blocked") as error:
            service.check(context, rule=rule, text="content", phase=phase)
        assert error.value.phase == phase
    else:
        assert service.check(context, rule=rule, text="content", phase=phase) is None

    assert gateway.calls == [(context, rule, "content", phase)]


@pytest.mark.parametrize("enabled", [False, "false", None])
def test_disabled_phases_skip_gateway_and_invalid_enablement_fails_closed(enabled: bool | str | None) -> None:
    gateway = RecordingModerationGateway(ModerationVerdict(flagged=True, message="Blocked"))
    service = ModerationService(gateway=gateway)
    rule = ModerationRule(type="api", config={"inputs_config": {"enabled": enabled}})
    context = AppRequestContext(tenant_id="tenant-1", app_id="")

    if enabled is False:
        service.check(context, rule=rule, text="text", phase="input")
    else:
        with pytest.raises(ValueError, match="enabled must be a bool"):
            service.check(context, rule=rule, text="text", phase="input")
    assert not gateway.calls


def test_missing_tenant_is_not_admitted_even_when_disabled() -> None:
    gateway = RecordingModerationGateway(ModerationVerdict(flagged=False, message=""))
    service = ModerationService(gateway=gateway)
    rule = ModerationRule(type="keywords", config={"inputs_config": {"enabled": False}})

    with pytest.raises(ValueError, match="tenant scope"):
        service.check(AppRequestContext(tenant_id="", app_id=""), rule=rule, text="text", phase="input")
    assert not gateway.calls


def test_rejection_has_a_safe_fallback_message() -> None:
    error = ModerationRejectedError("output", "")
    assert str(error) == "Model output was rejected by moderation."


def test_evaluate_preserves_app_replacement_data() -> None:
    replacement = ModerationReplacement(
        action="overridden",
        preset_response="Preset",
        inputs={"input": "rewritten"},
        query="rewritten query",
        text="rewritten output",
    )
    gateway = RecordingModerationGateway(ModerationVerdict(flagged=True, message="Blocked", replacement=replacement))
    service = ModerationService(gateway=gateway)
    rule = ModerationRule(type="keywords", config={"inputs_config": {"enabled": True}})

    verdict = service.evaluate(
        AppRequestContext(tenant_id="tenant-1", app_id="app-1"),
        rule=rule,
        request=ModerationRequest(text="", inputs={"input": "value"}, query="query"),
        phase="input",
    )

    assert verdict == ModerationVerdict(flagged=True, message="Blocked", replacement=replacement)
