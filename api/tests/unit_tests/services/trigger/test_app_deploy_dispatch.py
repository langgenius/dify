"""Deployed-trigger retries preserve dispatch identity across enterprise's claim lease."""

from copy import deepcopy

import pytest
from celery import Celery
from celery.exceptions import Retry

from enums import DeploymentEdition
from services.entities.feature_entities import SystemFeatureModel
from services.errors.enterprise import EnterpriseAPIError
from services.trigger import app_deploy_dispatch
from services.workflow.entities import PluginTriggerDispatchData


@pytest.mark.parametrize("lease_expires", [120, None], ids=["claim-expires", "always-busy"])
def test_dispatch_retries_preserve_payload_and_outlive_claim(
    monkeypatch: pytest.MonkeyPatch, lease_expires: int | None
) -> None:
    """Given immediate Busy responses, replay real retries without sleeping.

    A 120-second claim must expire before retries end; permanent Busy must exhaust
    exactly eight retries. Every failed and successful request keeps its payload.
    """
    payload = PluginTriggerDispatchData(
        user_id="plugin-user",
        tenant_id="tenant-id",
        endpoint_id="endpoint-id",
        provider_id="langgenius/github/github",
        subscription_id="subscription-id",
        timestamp=1234567890,
        events=["push", "push"],
        request_id="trigger_request_1234567890_abcdef012345",
    ).model_dump(mode="json")
    original_payload = deepcopy(payload)
    elapsed = 0
    attempts: list[tuple[int, dict[str, object]]] = []
    failures: list[EnterpriseAPIError] = []

    def enabled_features() -> SystemFeatureModel:
        """Enable the deployment gateway using its system feature contract."""
        return SystemFeatureModel(
            deployment_edition=DeploymentEdition.ENTERPRISE,
            agent_tracing_api_collection_enabled=False,
            enable_app_deploy=True,
        )

    def enterprise_request(
        method: str, endpoint: str, *, json: dict[str, object], raise_for_status: bool
    ) -> dict[str, bool]:
        """Record unchanged requests and reject dispatches while the lease is held."""
        assert method == "POST"
        assert endpoint == "/inner/api/app-deploy/triggers/plugin"
        assert raise_for_status is True
        attempts.append((elapsed, deepcopy(json)))
        if lease_expires is None or elapsed < lease_expires:
            error = EnterpriseAPIError("dispatch busy", status_code=409)
            failures.append(error)
            raise error
        return {"success": True}

    monkeypatch.setattr(app_deploy_dispatch.SystemFeatureService, "get_public_system_features", enabled_features)
    monkeypatch.setattr(app_deploy_dispatch.EnterpriseRequest, "send_request", enterprise_request)
    previous_app = app_deploy_dispatch.dispatch_deployed_triggers.app
    celery_app = Celery("deployed-trigger-retry-test", broker="memory://", set_as_current=False)
    celery_app.set_current()
    try:
        task = app_deploy_dispatch.dispatch_deployed_triggers
        signature = task.signature(args=(payload,), task_id="deployed-trigger-dispatch")
        countdowns = [30, 60, 120] if lease_expires is not None else [30, 60, 120, 120, 120, 120, 120, 120]
        for retries, countdown in enumerate(countdowns, start=1):
            # throw=True exposes Celery's Retry instead of eager mode immediately
            # recursing into its signature and ignoring the scheduled countdown.
            with pytest.raises(Retry) as raised:
                signature.apply(throw=True)
            retry = raised.value
            assert failures, repr(retry.exc)
            assert retry.exc is failures[-1]
            assert retry.when == countdown
            assert retry.sig is not None
            assert retry.sig.args == (original_payload,)
            assert retry.sig.kwargs == {}
            assert retry.sig.options["task_id"] == "deployed-trigger-dispatch"
            assert retry.sig.options["retries"] == retries
            assert retry.sig.options["countdown"] == countdown
            signature = retry.sig
            elapsed += countdown

        if lease_expires is None:
            with pytest.raises(EnterpriseAPIError) as exhausted:
                signature.apply(throw=True)
            assert exhausted.value is failures[-1]
            assert len(failures) == 9
            assert [time for time, _ in attempts] == [0, 30, 90, 210, 330, 450, 570, 690, 810]
        else:
            result = signature.apply(throw=True)
            assert result.successful()
            assert result.get() is None
            assert len(failures) == 3
            assert [time for time, _ in attempts] == [0, 30, 90, 210]
            assert attempts[-1][0] > lease_expires

        assert all(sent_payload == original_payload for _, sent_payload in attempts)
        assert payload == original_payload
    finally:
        previous_app.set_current()
        celery_app.close()
