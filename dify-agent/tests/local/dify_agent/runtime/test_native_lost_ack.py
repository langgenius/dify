"""Recover only actual API-completed I/O acknowledgement loss, never cancellation."""

import asyncio

import httpx
import pytest

from dify_agent.protocol.native_testing import AgentEffectReceipt
from dify_agent.runtime.native_effects import NativeEffectDispatcher
from tests.local.dify_agent.runtime.test_native_effects import REF, INTENT, PERMIT, Results


@pytest.mark.parametrize(
    "error_type", [TimeoutError, asyncio.CancelledError, KeyboardInterrupt, SystemExit, ValueError]
)
@pytest.mark.parametrize("outcome", ["completed", "unknown"])
def test_lost_ack_uses_canonical_result_only_for_transport_exception(error_type, outcome):
    async def exercise():
        calls = []
        settlements = []

        class Policy:
            async def record_outcome(self, **kwargs):
                settlements.append(kwargs)
                return AgentEffectReceipt(
                    operation_id=PERMIT.operation_id,
                    attempt_id=PERMIT.attempt_id,
                    outcome=outcome,
                    result_ref="recorded" if outcome == "completed" else None,
                )

        async def invoke(_permit):
            calls.append("business")
            raise error_type("test response lost")

        kwargs = {"ref": REF, "permit": PERMIT, "intent": INTENT, "invoke": invoke, "result_store": Results()}
        if error_type is TimeoutError and outcome == "completed":
            assert await NativeEffectDispatcher(policy=Policy()).invoke_permitted(**kwargs) == {"ok": True}
        else:
            with pytest.raises(error_type):
                await NativeEffectDispatcher(policy=Policy()).invoke_permitted(**kwargs)
        assert calls == ["business"]
        assert len(settlements) == 1
        assert settlements[0]["outcome"] == "unknown"

    asyncio.run(exercise())


def test_wrapped_http_io_can_recover_but_foreign_receipt_cannot():
    from dify_agent.layers.dify_core_tools.client import DifyCoreToolsClientError

    async def exercise():
        class Policy:
            def __init__(self, operation_id):
                self.operation_id = operation_id

            async def record_outcome(self, **_kwargs):
                return AgentEffectReceipt(
                    operation_id=self.operation_id,
                    attempt_id=PERMIT.attempt_id,
                    outcome="completed",
                    result_ref="recorded",
                )

        async def invoke(_permit):
            try:
                raise httpx.ReadTimeout("test socket lost")
            except httpx.RequestError as error:
                raise DifyCoreToolsClientError("test gateway response lost", retryable=True) from error

        kwargs = {"ref": REF, "permit": PERMIT, "intent": INTENT, "invoke": invoke, "result_store": Results()}
        assert await NativeEffectDispatcher(policy=Policy(PERMIT.operation_id)).invoke_permitted(**kwargs) == {
            "ok": True
        }
        with pytest.raises(DifyCoreToolsClientError):
            await NativeEffectDispatcher(policy=Policy("foreign-operation")).invoke_permitted(**kwargs)

    asyncio.run(exercise())
