"""Own trigger execution status transitions independently of workflow runtime models."""

from collections.abc import Callable
from datetime import UTC, datetime

from services.trigger.execution_store import TriggerExecution, TriggerExecutionStore


class TriggerExecutionService:
    def __init__(
        self,
        *,
        logs: TriggerExecutionStore,
        run: Callable[[TriggerExecution, datetime], None],
    ) -> None:
        self._logs = logs
        self._run = run

    def execute(self, log_id: str) -> None:
        """Run a claimable log once; skip missing or already claimed work.

        Runner failures are recorded through the store without retrying. Errors
        from claiming or recording a failure propagate to the caller.
        """
        execution = self._logs.start(log_id)
        if execution is None:
            return
        started_at = datetime.now(UTC)
        try:
            self._run(execution, started_at)
        except Exception as error:
            # Keep the existing terminal-failure behavior; task retries are not introduced here.
            finished_at = datetime.now(UTC)
            self._logs.fail(
                log=execution.log,
                error=str(error),
                finished_at=finished_at,
                elapsed_time=(finished_at - started_at).total_seconds(),
            )
