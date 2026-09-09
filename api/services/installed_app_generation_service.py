"""Generate completion, chat, and workflow responses for an admitted installation."""

from collections.abc import Iterator, Mapping
from datetime import datetime
from typing import Protocol

from libs.datetime_utils import naive_utc_now
from services.installed_app_access_service import InstalledAppRef


class GenerationStream(Protocol):
    def __iter__(self) -> Iterator[str]: ...

    def __next__(self) -> str: ...

    def close(self) -> None: ...


type GenerationResponse = Mapping[str, object] | GenerationStream


class InstalledAppNotCompletionError(ValueError):
    """The installed app does not support the completion endpoint."""


class InstalledAppNotChatError(ValueError):
    """The installed app does not support the chat endpoint."""


class InstalledAppNotWorkflowError(ValueError):
    """The installed app does not support the workflow endpoint."""


class InstalledAppUsageRecorder(Protocol):
    def record(self, *, installed_app: InstalledAppRef, used_at: datetime) -> None: ...


class InstalledAppGenerationRuntime(Protocol):
    def generate(
        self,
        *,
        app_id: str,
        account_id: str,
        args: Mapping[str, object],
        streaming: bool,
    ) -> GenerationResponse: ...

    def generate_more_like_this(
        self,
        *,
        app_id: str,
        account_id: str,
        message_id: str,
        streaming: bool,
    ) -> GenerationResponse: ...


class InstalledAppGenerationService:
    def __init__(
        self,
        *,
        usage: InstalledAppUsageRecorder,
        runtime: InstalledAppGenerationRuntime,
    ) -> None:
        self._usage: InstalledAppUsageRecorder = usage
        self._runtime: InstalledAppGenerationRuntime = runtime

    def generate_completion(
        self, *, installed_app: InstalledAppRef, account_id: str, args: Mapping[str, object]
    ) -> GenerationResponse:
        if installed_app.app_mode != "completion":
            raise InstalledAppNotCompletionError(f"App {installed_app.app_id} is not a completion app")

        return self._generate(
            installed_app=installed_app,
            account_id=account_id,
            args=args,
            streaming=args.get("response_mode") == "streaming",
        )

    def generate_chat(
        self, *, installed_app: InstalledAppRef, account_id: str, args: Mapping[str, object]
    ) -> GenerationResponse:
        if installed_app.app_mode not in {"chat", "agent-chat", "advanced-chat"}:
            raise InstalledAppNotChatError(f"App {installed_app.app_id} is not a chat app")

        return self._generate(installed_app=installed_app, account_id=account_id, args=args, streaming=True)

    def generate_more_like_this(
        self,
        *,
        installed_app: InstalledAppRef,
        account_id: str,
        message_id: str,
        streaming: bool,
    ) -> GenerationResponse:
        if installed_app.app_mode != "completion":
            raise InstalledAppNotCompletionError(f"App {installed_app.app_id} is not a completion app")

        # Regenerating an earlier message does not record installation usage.
        return self._runtime.generate_more_like_this(
            app_id=installed_app.app_id,
            account_id=account_id,
            message_id=message_id,
            streaming=streaming,
        )

    def generate_workflow(
        self, *, installed_app: InstalledAppRef, account_id: str, args: Mapping[str, object]
    ) -> GenerationResponse:
        if installed_app.app_mode != "workflow":
            raise InstalledAppNotWorkflowError(f"App {installed_app.app_id} is not a workflow app")

        # Workflow runs do not update installation usage or add chat naming options.
        return self._runtime.generate(
            app_id=installed_app.app_id,
            account_id=account_id,
            args=args,
            streaming=True,
        )

    def _generate(
        self,
        *,
        installed_app: InstalledAppRef,
        account_id: str,
        args: Mapping[str, object],
        streaming: bool,
    ) -> GenerationResponse:
        generation_args = dict(args)
        generation_args["auto_generate_name"] = False

        # Opening an installed app records usage even when generation fails.
        # Commit this independently before entering the generation runtime.
        self._usage.record(installed_app=installed_app, used_at=naive_utc_now())
        return self._runtime.generate(
            app_id=installed_app.app_id,
            account_id=account_id,
            args=generation_args,
            streaming=streaming,
        )
