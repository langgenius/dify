"""Codex CLI process runner and in-memory A2A task ledger."""

from __future__ import annotations

import asyncio
import json
import os
import signal
import uuid
from collections.abc import AsyncIterator
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from .models import (
    TASK_STATE_CANCELED,
    TASK_STATE_COMPLETED,
    TASK_STATE_FAILED,
    TASK_STATE_SUBMITTED,
    TASK_STATE_WORKING,
    TERMINAL_TASK_STATES,
    A2AMessage,
    ContextBusyError,
    InvalidMessageError,
    SendMessageRequest,
    TaskContinuationError,
    TaskNotCancelableError,
    TaskNotFoundError,
    TaskNotSubscribableError,
)
from .settings import CodexBridgeSettings


JsonObject = dict[str, Any]
A2A_SSE_EVENT_MAX_BYTES = 1024 * 1024


def _codex_subprocess_environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment.pop("DIFY_BYOA_CODEX_API_TOKEN", None)
    return environment


def utc_now() -> str:
    """Return an A2A-compatible UTC timestamp with millisecond precision."""
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass(frozen=True, slots=True)
class ParsedCodexEvent:
    """The deliberately small, non-sensitive projection of one Codex JSONL event."""

    event_type: str
    thread_id: str | None = None
    agent_text: str | None = None
    item_id: str | None = None
    usage: JsonObject | None = None
    turn_completed: bool = False
    turn_failed: bool = False


def parse_codex_json_line(line: bytes | str) -> ParsedCodexEvent:
    """Parse stable Codex JSONL fields without retaining arbitrary command output."""
    try:
        payload = json.loads(line)
    except (json.JSONDecodeError, UnicodeDecodeError, TypeError):
        return ParsedCodexEvent(event_type="invalid-jsonl")
    if not isinstance(payload, dict) or not isinstance(payload.get("type"), str):
        return ParsedCodexEvent(event_type="invalid-jsonl")

    event_type = payload["type"]
    if event_type == "thread.started":
        thread_id = payload.get("thread_id")
        return ParsedCodexEvent(
            event_type=event_type,
            thread_id=thread_id if isinstance(thread_id, str) and thread_id else None,
        )

    if event_type == "item.completed":
        item = payload.get("item")
        if not isinstance(item, dict) or not isinstance(item.get("type"), str):
            return ParsedCodexEvent(event_type=event_type)
        item_type = item["type"]
        projected_type = f"{event_type}.{item_type}"
        if item_type != "agent_message":
            return ParsedCodexEvent(event_type=projected_type)
        text = item.get("text")
        item_id = item.get("id")
        return ParsedCodexEvent(
            event_type=projected_type,
            agent_text=text if isinstance(text, str) and text else None,
            item_id=item_id if isinstance(item_id, str) and item_id else None,
        )

    if event_type == "turn.completed":
        usage = _safe_usage(payload.get("usage"))
        return ParsedCodexEvent(event_type=event_type, usage=usage, turn_completed=True)
    if event_type == "turn.failed":
        return ParsedCodexEvent(event_type=event_type, turn_failed=True)
    if event_type == "error":
        # Error bodies can contain provider or local details. The A2A task exposes
        # only the stable event type and a generic terminal failure message.
        return ParsedCodexEvent(event_type=event_type)
    return ParsedCodexEvent(event_type=event_type)


def _safe_usage(value: object) -> JsonObject | None:
    if not isinstance(value, dict):
        return None
    key_map = {
        "input_tokens": "inputTokens",
        "cached_input_tokens": "cachedInputTokens",
        "output_tokens": "outputTokens",
        "reasoning_output_tokens": "reasoningOutputTokens",
    }
    usage = {
        output_key: token_count
        for input_key, output_key in key_map.items()
        if isinstance((token_count := value.get(input_key)), int) and not isinstance(token_count, bool)
    }
    return usage or None


class CodexCommandBuilder:
    """Build shell-free Codex invocations from server-owned settings only."""

    def __init__(self, settings: CodexBridgeSettings) -> None:
        self._settings = settings

    def build(self, *, thread_id: str | None) -> list[str]:
        # A local bridge cannot service an interactive approval prompt. Keep the
        # authorization policy explicit instead of inheriting a mutable user default.
        command = [self._settings.codex_executable, "-a", "never", "exec"]
        if thread_id is not None:
            command.append("resume")
        command.extend(["--json", "--skip-git-repo-check"])
        if self._settings.ignore_user_config:
            command.append("--ignore-user-config")
        if self._settings.model is not None:
            command.extend(["-m", self._settings.model])
        if self._settings.reasoning_effort is not None:
            command.extend(["-c", f'model_reasoning_effort="{self._settings.reasoning_effort}"'])

        if thread_id is None:
            command.extend(
                [
                    "--sandbox",
                    self._settings.sandbox_mode,
                    "-C",
                    str(self._settings.workspace_root),
                ]
            )
        else:
            # Resume has no --cd or --sandbox flags. The bridge runs it with the
            # fixed cwd and reasserts the sandbox through the config override.
            command.extend(["-c", f'sandbox_mode="{self._settings.sandbox_mode}"', thread_id])
        command.append("-")
        return command


@dataclass(slots=True)
class TaskRecord:
    id: str
    context_id: str
    request_message: A2AMessage
    state: str = TASK_STATE_SUBMITTED
    status_timestamp: str = field(default_factory=utc_now)
    history: list[JsonObject] = field(default_factory=list)
    artifacts: list[JsonObject] = field(default_factory=list)
    metadata: JsonObject = field(default_factory=dict)
    status_message: JsonObject | None = None
    events: list[JsonObject] = field(default_factory=list)
    condition: asyncio.Condition = field(default_factory=asyncio.Condition)
    done: asyncio.Event = field(default_factory=asyncio.Event)
    process: asyncio.subprocess.Process | None = None
    execution: asyncio.Task[None] | None = None
    cancel_requested: bool = False
    observed_event_types: list[str] = field(default_factory=list)

    def to_dict(
        self,
        *,
        history_length: int | None = None,
        include_artifacts: bool = True,
    ) -> JsonObject:
        status: JsonObject = {"state": self.state, "timestamp": self.status_timestamp}
        if self.status_message is not None:
            status["message"] = self.status_message
        task: JsonObject = {
            "id": self.id,
            "contextId": self.context_id,
            "status": status,
        }
        if include_artifacts and self.artifacts:
            task["artifacts"] = list(self.artifacts)
        if history_length != 0 and self.history:
            history = self.history if history_length is None else self.history[-history_length:]
            task["history"] = list(history)
        if self.metadata:
            task["metadata"] = dict(self.metadata)
        return task


@dataclass(frozen=True, slots=True)
class TaskEventSubscription:
    """A race-free snapshot plus cursor for one task subscription."""

    record: TaskRecord
    initial_events: tuple[JsonObject, ...]
    next_event_index: int


class CodexA2ARuntime:
    """Own Codex subprocesses and project them onto A2A task semantics."""

    def __init__(self, settings: CodexBridgeSettings) -> None:
        self._settings = settings
        self._command_builder = CodexCommandBuilder(settings)
        self._tasks: dict[str, TaskRecord] = {}
        self._message_tasks: dict[str, str] = {}
        self._context_threads: dict[str, str] = {}
        self._active_contexts: dict[str, str] = {}
        self._ledger_lock = asyncio.Lock()
        self._semaphore = asyncio.Semaphore(settings.max_concurrent_tasks)

    async def start(self, request: SendMessageRequest) -> tuple[TaskRecord, bool]:
        """Create an idempotent task and schedule its Codex turn."""
        if request.tenant:
            raise InvalidMessageError("This local bridge does not expose A2A tenant routing")
        prompt = request.message.prompt_text()
        if request.message.task_id is not None:
            if request.message.task_id not in self._tasks:
                raise TaskNotFoundError(request.message.task_id)
            raise TaskContinuationError()

        async with self._ledger_lock:
            existing_id = self._message_tasks.get(request.message.message_id)
            if existing_id is not None:
                return self._tasks[existing_id], False

            context_id = request.message.context_id or str(uuid.uuid4())
            active_task_id = self._active_contexts.get(context_id)
            if active_task_id is not None and not self._tasks[active_task_id].done.is_set():
                raise ContextBusyError(context_id)

            task_id = str(uuid.uuid4())
            record = TaskRecord(id=task_id, context_id=context_id, request_message=request.message)
            record.history.append(self._input_message(record))
            record.events.append({"task": record.to_dict()})
            self._tasks[task_id] = record
            self._message_tasks[request.message.message_id] = task_id
            self._active_contexts[context_id] = task_id
            resume_thread_id = self._context_threads.get(context_id)
            record.execution = asyncio.create_task(
                self._execute(record, prompt=prompt, resume_thread_id=resume_thread_id),
                name=f"codex-a2a-{task_id}",
            )
            return record, True

    def get(self, task_id: str) -> TaskRecord:
        try:
            return self._tasks[task_id]
        except KeyError as exc:
            raise TaskNotFoundError(task_id) from exc

    async def stream(self, task_id: str) -> AsyncIterator[JsonObject]:
        """Yield every retained stream event, then follow new events to terminal state."""
        record = self.get(task_id)
        async for event in self._stream_from(record, start_index=0):
            yield event

    async def prepare_subscription(self, task_id: str) -> TaskEventSubscription:
        """Capture a current Task and an event cursor before response headers are sent."""
        record = self.get(task_id)
        async with record.condition:
            if record.state in TERMINAL_TASK_STATES:
                raise TaskNotSubscribableError(task_id)
            initial_task = {
                "task": record.to_dict(history_length=0, include_artifacts=False),
            }
            # Existing artifacts are replayed as their bounded chunks. Embedding
            # the assembled artifact in the initial Task could exceed Dify's SSE
            # per-event limit.
            retained_artifacts = tuple(event for event in record.events if "artifactUpdate" in event)
            return TaskEventSubscription(
                record=record,
                initial_events=(initial_task, *retained_artifacts),
                next_event_index=len(record.events),
            )

    async def stream_subscription(self, subscription: TaskEventSubscription) -> AsyncIterator[JsonObject]:
        """Yield a subscription snapshot, retained artifacts, and future updates."""
        for event in subscription.initial_events:
            yield event
        async for event in self._stream_from(
            subscription.record,
            start_index=subscription.next_event_index,
        ):
            yield event

    @staticmethod
    async def _stream_from(record: TaskRecord, *, start_index: int) -> AsyncIterator[JsonObject]:
        index = start_index
        while True:
            async with record.condition:
                await record.condition.wait_for(lambda: index < len(record.events) or record.done.is_set())
                batch = record.events[index:]
                index = len(record.events)
                finished = record.done.is_set() and index == len(record.events)
            for event in batch:
                yield event
            if finished:
                return

    async def cancel(self, task_id: str) -> TaskRecord:
        record = self.get(task_id)
        if record.state in TERMINAL_TASK_STATES:
            if record.state == TASK_STATE_CANCELED:
                return record
            raise TaskNotCancelableError(task_id)

        record.cancel_requested = True
        process = record.process
        execution = record.execution
        if process is not None:
            await self._terminate_process(process)
        elif execution is not None and not execution.done():
            execution.cancel()

        if execution is not None:
            with suppress(asyncio.CancelledError):
                await execution
        if not record.done.is_set():
            await self._finish(record, TASK_STATE_CANCELED)
        return record

    async def shutdown(self) -> None:
        """Best-effort cancellation for all process-local tasks."""
        active_ids = [task_id for task_id, record in self._tasks.items() if not record.done.is_set()]
        for task_id in active_ids:
            with suppress(TaskNotCancelableError):
                await self.cancel(task_id)

    async def _execute(self, record: TaskRecord, *, prompt: str, resume_thread_id: str | None) -> None:
        try:
            async with self._semaphore:
                if record.cancel_requested:
                    await self._finish(record, TASK_STATE_CANCELED)
                    return
                await self._run_process(record, prompt=prompt, resume_thread_id=resume_thread_id)
        except asyncio.CancelledError:
            if record.process is not None:
                await self._terminate_process(record.process)
            await self._finish(record, TASK_STATE_CANCELED)
        except Exception:
            # Raw subprocess errors and stderr are intentionally not copied to
            # A2A responses because they may contain local machine details.
            if record.cancel_requested:
                await self._finish(record, TASK_STATE_CANCELED)
            else:
                await self._finish(record, TASK_STATE_FAILED, status_text="Codex execution failed")
        finally:
            record.process = None

    async def _run_process(self, record: TaskRecord, *, prompt: str, resume_thread_id: str | None) -> None:
        process = await asyncio.create_subprocess_exec(
            *self._command_builder.build(thread_id=resume_thread_id),
            cwd=self._settings.workspace_root,
            env=_codex_subprocess_environment(),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=4 * 1024 * 1024,
            start_new_session=os.name == "posix",
        )
        record.process = process
        if record.cancel_requested:
            await self._terminate_process(process)
            await self._finish(record, TASK_STATE_CANCELED)
            return

        await self._set_state(record, TASK_STATE_WORKING)
        if process.stdin is None or process.stdout is None or process.stderr is None:
            raise RuntimeError("Codex process pipes were not created")
        stderr_task = asyncio.create_task(self._discard_stream(process.stderr))
        process.stdin.write(prompt.encode("utf-8"))
        await process.stdin.drain()
        process.stdin.close()
        await process.stdin.wait_closed()

        turn_completed = False
        turn_failed = False
        async for line in process.stdout:
            event = parse_codex_json_line(line)
            turn_completed = turn_completed or event.turn_completed
            turn_failed = turn_failed or event.turn_failed
            await self._apply_event(record, event, expected_thread_id=resume_thread_id)

        return_code = await process.wait()
        await stderr_task
        if record.cancel_requested:
            await self._finish(record, TASK_STATE_CANCELED)
        elif return_code == 0 and turn_completed and not turn_failed:
            if "codexThreadId" not in record.metadata:
                await self._finish(record, TASK_STATE_FAILED, status_text="Codex did not report a thread id")
            else:
                await self._finish(record, TASK_STATE_COMPLETED)
        else:
            await self._finish(record, TASK_STATE_FAILED, status_text="Codex turn failed")

    async def _apply_event(
        self,
        record: TaskRecord,
        event: ParsedCodexEvent,
        *,
        expected_thread_id: str | None,
    ) -> None:
        if event.event_type not in record.observed_event_types:
            record.observed_event_types.append(event.event_type)
            record.metadata["codexEventTypes"] = list(record.observed_event_types)

        if event.thread_id is not None:
            if expected_thread_id is not None and event.thread_id != expected_thread_id:
                raise RuntimeError("Codex resumed a different thread")
            record.metadata["codexThreadId"] = event.thread_id
            async with self._ledger_lock:
                self._context_threads[record.context_id] = event.thread_id

        if event.usage is not None:
            record.metadata["codexUsage"] = event.usage

        if event.agent_text is not None:
            item_id = event.item_id or str(uuid.uuid4())
            artifact = {
                "artifactId": item_id,
                "name": "Codex response",
                "parts": [{"text": event.agent_text, "mediaType": "text/plain"}],
            }
            record.artifacts.append(artifact)
            record.history.append(self._agent_message(record, event.agent_text))
            template = self._artifact_update_event(
                record,
                artifact_id=item_id,
                text="",
                append=False,
                last_chunk=False,
            )
            text_budget = A2A_SSE_EVENT_MAX_BYTES - _json_payload_size(template) - 1
            chunks = _split_json_text(event.agent_text, max_escaped_bytes=text_budget)
            for index, chunk in enumerate(chunks):
                artifact_event = self._artifact_update_event(
                    record,
                    artifact_id=item_id,
                    text=chunk,
                    append=index > 0,
                    last_chunk=index == len(chunks) - 1,
                )
                if _json_payload_size(artifact_event) >= A2A_SSE_EVENT_MAX_BYTES:
                    raise RuntimeError("A2A artifact chunk exceeded the configured SSE event limit")
                await self._publish(record, artifact_event)

    @staticmethod
    def _artifact_update_event(
        record: TaskRecord,
        *,
        artifact_id: str,
        text: str,
        append: bool,
        last_chunk: bool,
    ) -> JsonObject:
        return {
            "artifactUpdate": {
                "taskId": record.id,
                "contextId": record.context_id,
                "artifact": {
                    "artifactId": artifact_id,
                    "name": "Codex response",
                    "parts": [{"text": text, "mediaType": "text/plain"}],
                },
                "append": append,
                "lastChunk": last_chunk,
            }
        }

    async def _set_state(self, record: TaskRecord, state: str, *, status_text: str | None = None) -> None:
        record.state = state
        record.status_timestamp = utc_now()
        record.status_message = self._agent_message(record, status_text) if status_text is not None else None
        update: JsonObject = {
            "taskId": record.id,
            "contextId": record.context_id,
            "status": record.to_dict()["status"],
        }
        if record.metadata:
            update["metadata"] = dict(record.metadata)
        await self._publish(
            record,
            {"statusUpdate": update},
        )

    async def _finish(self, record: TaskRecord, state: str, *, status_text: str | None = None) -> None:
        if record.done.is_set():
            return
        await self._set_state(record, state, status_text=status_text)
        record.done.set()
        async with self._ledger_lock:
            if self._active_contexts.get(record.context_id) == record.id:
                self._active_contexts.pop(record.context_id, None)
        async with record.condition:
            record.condition.notify_all()

    async def _publish(self, record: TaskRecord, event: JsonObject) -> None:
        async with record.condition:
            record.events.append(event)
            record.condition.notify_all()

    async def _terminate_process(self, process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return
        self._signal_process(process, signal.SIGTERM)
        try:
            await asyncio.wait_for(process.wait(), timeout=self._settings.cancel_grace_seconds)
        except TimeoutError:
            self._signal_process(process, signal.SIGKILL)
            await process.wait()

    @staticmethod
    def _signal_process(process: asyncio.subprocess.Process, sig: signal.Signals) -> None:
        with suppress(ProcessLookupError):
            if os.name == "posix":
                os.killpg(process.pid, sig)
            elif sig == signal.SIGTERM:
                process.terminate()
            else:
                process.kill()

    @staticmethod
    async def _discard_stream(stream: asyncio.StreamReader) -> None:
        while await stream.read(64 * 1024):
            pass

    @staticmethod
    def _input_message(record: TaskRecord) -> JsonObject:
        # Keep task history useful without reflecting arbitrary request metadata
        # that could include local hints or values resembling credentials.
        return {
            "messageId": record.request_message.message_id,
            "contextId": record.context_id,
            "taskId": record.id,
            "role": "ROLE_USER",
            "parts": [
                {
                    "text": part.text,
                    "mediaType": part.media_type or "text/plain",
                }
                for part in record.request_message.parts
                if part.text is not None
            ],
        }

    @staticmethod
    def _agent_message(record: TaskRecord, text: str) -> JsonObject:
        return {
            "messageId": str(uuid.uuid4()),
            "contextId": record.context_id,
            "taskId": record.id,
            "role": "ROLE_AGENT",
            "parts": [{"text": text, "mediaType": "text/plain"}],
        }


def _json_payload_size(payload: JsonObject) -> int:
    return len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _split_json_text(text: str, *, max_escaped_bytes: int) -> list[str]:
    """Split text by its JSON-escaped UTF-8 size without breaking code points."""
    if max_escaped_bytes < 6:
        raise ValueError("max_escaped_bytes is too small for a JSON text chunk")

    chunks: list[str] = []
    start = 0
    current_size = 0
    for index, character in enumerate(text):
        character_size = _json_escaped_character_size(character)
        if current_size and current_size + character_size > max_escaped_bytes:
            chunks.append(text[start:index])
            start = index
            current_size = 0
        if character_size > max_escaped_bytes:
            raise ValueError("A Unicode code point cannot fit in the JSON text chunk budget")
        current_size += character_size
    chunks.append(text[start:])
    return chunks


def _json_escaped_character_size(character: str) -> int:
    if character in {'"', "\\", "\b", "\f", "\n", "\r", "\t"}:
        return 2
    if ord(character) < 0x20:
        return 6
    return len(character.encode("utf-8"))


__all__ = [
    "A2A_SSE_EVENT_MAX_BYTES",
    "CodexA2ARuntime",
    "CodexCommandBuilder",
    "ParsedCodexEvent",
    "TaskEventSubscription",
    "TaskRecord",
    "parse_codex_json_line",
]
