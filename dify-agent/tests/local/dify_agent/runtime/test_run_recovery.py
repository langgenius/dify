"""Scheduler admission unit cases, not Redis atomicity qualification."""

import asyncio

import httpx

from dify_agent.protocol.schemas import CreateRunRequest
from dify_agent.runtime.context import Services
from dify_agent.runtime.run_scheduler import RunScheduler
from dify_agent.server.schemas import RunRecord


def test_existing_keyed_record_is_never_scheduled_even_after_worker_loss():
    async def exercise():
        from dify_agent.server.schemas import RunCreateClaim

        record = RunRecord(run_id="existing", status="running")

        class Store:
            async def claim_run(self, *, selection, identity):
                assert selection.idempotency_key == "accepted"
                assert len(selection.request_digest) == 64
                return RunCreateClaim(record=record, inserted=False)

        scheduler = RunScheduler(
            store=Store(),
            services=Services(plugin_daemon_http_client=httpx.AsyncClient(), dify_api_http_client=httpx.AsyncClient()),
        )
        result = await scheduler.create_run(CreateRunRequest(composition={"layers": []}, idempotency_key="accepted"))
        assert result == record
        assert scheduler.active_tasks == {}

    asyncio.run(exercise())
