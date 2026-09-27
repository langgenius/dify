"""Generate responses and record usage for an admitted trial app."""

import logging
from collections.abc import Iterator, Mapping
from typing import Protocol

from services.trial_app_access_service import TrialAppRef
from services.trial_app_usage import TrialAppUsageRecorder

logger = logging.getLogger(__name__)


class GenerationStream(Protocol):
    def __iter__(self) -> Iterator[str]: ...

    def __next__(self) -> str: ...

    def close(self) -> None: ...


type GenerationResponse = Mapping[str, object] | GenerationStream


class TrialAppNotCompletionError(ValueError):
    """The trial app does not support completion requests."""


class TrialAppNotChatError(ValueError):
    """The trial app does not support chat requests."""


class TrialAppNotWorkflowError(ValueError):
    """The trial app does not support workflow requests."""


class TrialAppGenerationRuntime(Protocol):
    def generate(
        self,
        *,
        app: TrialAppRef,
        account_id: str,
        args: Mapping[str, object],
        streaming: bool,
    ) -> GenerationResponse: ...


class TrialAppGenerationService:
    def __init__(self, *, runtime: TrialAppGenerationRuntime, usage: TrialAppUsageRecorder) -> None:
        self._runtime: TrialAppGenerationRuntime = runtime
        self._usage: TrialAppUsageRecorder = usage

    def generate_chat(
        self, *, trial_app: TrialAppRef, account_id: str, args: Mapping[str, object]
    ) -> GenerationResponse:
        if trial_app.app_mode not in {"chat", "agent-chat", "advanced-chat"}:
            raise TrialAppNotChatError(f"App {trial_app.app_id} is not a chat app")
        return self._generate(
            trial_app=trial_app, account_id=account_id, args={**args, "auto_generate_name": False}, streaming=True
        )

    def generate_completion(
        self, *, trial_app: TrialAppRef, account_id: str, args: Mapping[str, object]
    ) -> GenerationResponse:
        if trial_app.app_mode != "completion":
            raise TrialAppNotCompletionError(f"App {trial_app.app_id} is not a completion app")
        return self._generate(
            trial_app=trial_app,
            account_id=account_id,
            args={**args, "auto_generate_name": False},
            streaming=args.get("response_mode") == "streaming",
        )

    def generate_workflow(
        self, *, trial_app: TrialAppRef, account_id: str, args: Mapping[str, object]
    ) -> GenerationResponse:
        if trial_app.app_mode != "workflow":
            raise TrialAppNotWorkflowError(f"App {trial_app.app_id} is not a workflow app")
        return self._generate(trial_app=trial_app, account_id=account_id, args=args, streaming=True)

    def _generate(
        self, *, trial_app: TrialAppRef, account_id: str, args: Mapping[str, object], streaming: bool
    ) -> GenerationResponse:
        response = self._runtime.generate(app=trial_app, account_id=account_id, args=args, streaming=streaming)
        try:
            # Trial usage is recorded after generation returns, before any SSE
            # consumption. A later stream failure does not refund this attempt.
            self._usage.record(app_id=trial_app.app_id, account_id=account_id)
        except BaseException:
            if not isinstance(response, Mapping):
                try:
                    response.close()
                except BaseException:
                    logger.exception("Failed to close trial generation response for app %s", trial_app.app_id)
            raise
        return response
