"""Generate completion and chat responses for an admitted workspace installation."""

from collections.abc import Iterator, Mapping
from datetime import datetime
from typing import Protocol

from libs.datetime_utils import naive_utc_now
from services.app_definition_query_service import AppDefinitionQueryService
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


class InstalledAppGenerationService:
    def __init__(
        self,
        *,
        app_definitions: AppDefinitionQueryService,
        usage: InstalledAppUsageRecorder,
        runtime: InstalledAppGenerationRuntime,
    ) -> None:
        self._app_definitions: AppDefinitionQueryService = app_definitions
        self._usage: InstalledAppUsageRecorder = usage
        self._runtime: InstalledAppGenerationRuntime = runtime

    def generate_completion(
        self, *, installed_app: InstalledAppRef, account_id: str, args: Mapping[str, object]
    ) -> GenerationResponse:
        if self._app_definitions.get_mode(installed_app.app_id) != "completion":
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
        if self._app_definitions.get_mode(installed_app.app_id) not in {"chat", "agent-chat", "advanced-chat"}:
            raise InstalledAppNotChatError(f"App {installed_app.app_id} is not a chat app")

        return self._generate(installed_app=installed_app, account_id=account_id, args=args, streaming=True)

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
