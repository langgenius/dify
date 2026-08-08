from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol
from uuid import NAMESPACE_URL, uuid5

from clients.a2a import (
    A2AAgentCard,
    A2AAgentInterface,
    A2AArtifact,
    A2AClient,
    A2AClientError,
    A2AMessage,
    A2AProtocolError,
    A2ARemoteError,
    A2AStreamResponse,
    A2ATask,
    A2ATaskState,
    A2ATransportError,
    validate_same_origin_interface,
)
from core.db.session_factory import session_factory


class ExternalAgentRuntimeConfigLike(Protocol):
    @property
    def endpoint(self) -> str: ...

    @property
    def decrypted_bearer_token(self) -> str | None: ...

    @property
    def protocol_version(self) -> str: ...

    @property
    def remote_agent_id(self) -> str: ...

    @property
    def agent_card(self) -> A2AAgentCard: ...


class ExternalAgentRuntimeConfigProvider(Protocol):
    def get_runtime_config(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        agent_config_snapshot_id: str,
    ) -> ExternalAgentRuntimeConfigLike: ...


class DatabaseExternalAgentRuntimeConfigProvider:
    """Read and decrypt an external-agent snapshot before outbound I/O starts."""

    def get_runtime_config(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        agent_config_snapshot_id: str,
    ) -> ExternalAgentRuntimeConfigLike:
        # Lazy import keeps the workflow package independent from console
        # controller initialization and makes the provider straightforward to fake.
        from services.agent.external_agent_service import ExternalAgentService

        with session_factory.create_session() as session:
            return ExternalAgentService(session).get_runtime_config(
                tenant_id=tenant_id,
                agent_id=agent_id,
                agent_config_snapshot_id=agent_config_snapshot_id,
            )


class WorkflowExternalAgentRunError(RuntimeError):
    def __init__(self, error_code: str, message: str) -> None:
        self.error_code = error_code
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class WorkflowExternalAgentRunResult:
    raw_output: dict[str, Any]
    task_id: str | None
    context_id: str | None
    event_count: int
    task_state: A2ATaskState | None
    metadata: dict[str, Any]


class A2ARuntimeClient(Protocol):
    def stream_message(
        self,
        *,
        interface: A2AAgentInterface,
        text: str,
        metadata: Mapping[str, Any] | None = None,
        context_id: str | None = None,
        task_id: str | None = None,
        message_id: str | None = None,
        deadline_monotonic: float | None = None,
        on_activity: Callable[[], None] | None = None,
    ) -> Iterable[A2AStreamResponse]: ...

    def send_message(
        self,
        *,
        interface: A2AAgentInterface,
        text: str,
        metadata: Mapping[str, Any] | None = None,
        context_id: str | None = None,
        task_id: str | None = None,
        message_id: str | None = None,
        return_immediately: bool = False,
        deadline_monotonic: float | None = None,
        on_activity: Callable[[], None] | None = None,
    ) -> Any: ...

    def get_task(
        self,
        *,
        interface: A2AAgentInterface,
        task_id: str,
        deadline_monotonic: float | None = None,
        on_activity: Callable[[], None] | None = None,
    ) -> A2ATask: ...

    def cancel_task(
        self,
        *,
        interface: A2AAgentInterface,
        task_id: str,
        deadline_monotonic: float | None = None,
    ) -> A2ATask: ...


type A2AClientFactory = Callable[[str, str | None], A2ARuntimeClient]


def _default_client_factory(endpoint: str, bearer_token: str | None) -> A2ARuntimeClient:
    return A2AClient(endpoint, bearer_token=bearer_token)


class WorkflowExternalAgentRunner:
    """Execute one Workflow Agent invocation through A2A 1.0 HTTP+JSON."""

    def __init__(
        self,
        *,
        config_provider: ExternalAgentRuntimeConfigProvider | None = None,
        client_factory: A2AClientFactory = _default_client_factory,
        run_timeout_seconds: float = 600.0,
        poll_interval_seconds: float = 0.5,
    ) -> None:
        self._config_provider = config_provider or DatabaseExternalAgentRuntimeConfigProvider()
        self._client_factory = client_factory
        self._run_timeout_seconds = run_timeout_seconds
        self._poll_interval_seconds = poll_interval_seconds

    def run(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        agent_config_snapshot_id: str,
        prompt: str,
        request_metadata: Mapping[str, Any],
        has_explicit_outputs: bool,
        should_stop: Callable[[], bool],
    ) -> WorkflowExternalAgentRunResult:
        try:
            config = self._config_provider.get_runtime_config(
                tenant_id=tenant_id,
                agent_id=agent_id,
                agent_config_snapshot_id=agent_config_snapshot_id,
            )
            interface = config.agent_card.preferred_http_interface()
            validate_same_origin_interface(config.endpoint, interface.url)
        except WorkflowExternalAgentRunError:
            raise
        except (A2AProtocolError, ValueError) as error:
            raise WorkflowExternalAgentRunError("external_agent_protocol_error", str(error)) from error
        except Exception as error:
            raise WorkflowExternalAgentRunError(
                "external_agent_config_unavailable",
                "External agent connection configuration is unavailable.",
            ) from error

        client = self._client_factory(config.endpoint, config.decrypted_bearer_token)
        accumulator = _A2AResultAccumulator()
        started_at = time.monotonic()
        wire_metadata = {
            "dify": {
                "workflow_run_id": request_metadata.get("workflow_run_id"),
                "node_id": request_metadata.get("node_id"),
                "node_execution_id": request_metadata.get("node_execution_id"),
            }
        }
        context_id = self._context_id(request_metadata)
        message_id = self._message_id(context_id=context_id, prompt=prompt)
        deadline_monotonic = started_at + self._run_timeout_seconds

        try:
            if config.agent_card.capabilities.streaming:
                for event in client.stream_message(
                    interface=interface,
                    text=prompt,
                    context_id=context_id,
                    message_id=message_id,
                    metadata=wire_metadata,
                    deadline_monotonic=deadline_monotonic,
                    on_activity=lambda: self._cancel_if_stopped(
                        client,
                        interface,
                        accumulator,
                        should_stop,
                    ),
                ):
                    accumulator.consume_stream(event)
                    self._cancel_if_stopped(client, interface, accumulator, should_stop)
                    if accumulator.is_terminal or (accumulator.message is not None and accumulator.task_id is None):
                        break
            else:
                response = client.send_message(
                    interface=interface,
                    text=prompt,
                    context_id=context_id,
                    message_id=message_id,
                    metadata=wire_metadata,
                    return_immediately=True,
                    deadline_monotonic=deadline_monotonic,
                    on_activity=lambda: self._cancel_if_stopped(
                        client,
                        interface,
                        accumulator,
                        should_stop,
                    ),
                )
                accumulator.consume_send_response(response)

            if accumulator.task_id is not None and not accumulator.is_terminal:
                self._poll_until_terminal(
                    client=client,
                    interface=interface,
                    accumulator=accumulator,
                    started_at=started_at,
                    should_stop=should_stop,
                )
        except WorkflowExternalAgentRunError:
            raise
        except A2ATransportError as error:
            if accumulator.task_id is not None:
                self._best_effort_cancel(client, interface, accumulator.task_id)
            if time.monotonic() >= deadline_monotonic:
                raise WorkflowExternalAgentRunError(
                    "external_agent_timeout",
                    f"External agent task exceeded {self._run_timeout_seconds:g} seconds.",
                ) from error
            raise WorkflowExternalAgentRunError("external_agent_transport_error", str(error)) from error
        except A2AProtocolError as error:
            raise WorkflowExternalAgentRunError("external_agent_protocol_error", str(error)) from error
        except A2ARemoteError as error:
            raise WorkflowExternalAgentRunError("external_agent_remote_error", str(error)) from error
        except A2AClientError as error:
            raise WorkflowExternalAgentRunError("external_agent_runtime_error", str(error)) from error

        self._raise_for_terminal_state(accumulator)
        if accumulator.task_id is not None and accumulator.task_state is None:
            raise WorkflowExternalAgentRunError(
                "external_agent_stream_incomplete",
                "External agent response ended before a terminal task status.",
            )
        if accumulator.task_id is None and accumulator.message is None:
            raise WorkflowExternalAgentRunError(
                "external_agent_stream_incomplete",
                "External agent response contained neither a task nor a message.",
            )

        elapsed_ms = max(0, round((time.monotonic() - started_at) * 1000))
        return WorkflowExternalAgentRunResult(
            raw_output=accumulator.to_workflow_output(has_explicit_outputs=has_explicit_outputs),
            task_id=accumulator.task_id,
            context_id=accumulator.context_id,
            event_count=accumulator.event_count,
            task_state=accumulator.task_state,
            metadata={
                "protocol": "a2a",
                "protocol_version": interface.protocol_version,
                "remote_agent_id": config.remote_agent_id,
                "streaming": config.agent_card.capabilities.streaming,
                "task_id": accumulator.task_id,
                "context_id": accumulator.context_id,
                "task_state": accumulator.task_state.value if accumulator.task_state is not None else None,
                "event_count": accumulator.event_count,
                "elapsed_ms": elapsed_ms,
                "status": "succeeded",
            },
        )

    @staticmethod
    def _context_id(request_metadata: Mapping[str, Any]) -> str:
        """Create a stable opaque A2A context for retries of one node execution."""

        seed = "|".join(
            str(request_metadata.get(key) or "")
            for key in ("tenant_id", "workflow_run_id", "node_id", "node_execution_id")
        )
        return str(uuid5(NAMESPACE_URL, f"dify-external-agent:{seed}"))

    @staticmethod
    def _message_id(*, context_id: str, prompt: str) -> str:
        """Return an idempotent message ID for one rendered node execution."""

        prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
        return str(uuid5(NAMESPACE_URL, f"dify-external-agent-message:{context_id}:{prompt_hash}"))

    def _poll_until_terminal(
        self,
        *,
        client: A2ARuntimeClient,
        interface: A2AAgentInterface,
        accumulator: _A2AResultAccumulator,
        started_at: float,
        should_stop: Callable[[], bool],
    ) -> None:
        task_id = accumulator.task_id
        if task_id is None:
            return
        while not accumulator.is_terminal:
            self._cancel_if_stopped(client, interface, accumulator, should_stop)
            if time.monotonic() - started_at >= self._run_timeout_seconds:
                self._best_effort_cancel(client, interface, task_id)
                raise WorkflowExternalAgentRunError(
                    "external_agent_timeout",
                    f"External agent task exceeded {self._run_timeout_seconds:g} seconds.",
                )
            if self._poll_interval_seconds > 0:
                time.sleep(self._poll_interval_seconds)
            accumulator.consume_task(
                client.get_task(
                    interface=interface,
                    task_id=task_id,
                    deadline_monotonic=started_at + self._run_timeout_seconds,
                    on_activity=lambda: self._cancel_if_stopped(
                        client,
                        interface,
                        accumulator,
                        should_stop,
                    ),
                )
            )

    @staticmethod
    def _cancel_if_stopped(
        client: A2ARuntimeClient,
        interface: A2AAgentInterface,
        accumulator: _A2AResultAccumulator,
        should_stop: Callable[[], bool],
    ) -> None:
        if not should_stop():
            return
        if accumulator.task_id is not None:
            WorkflowExternalAgentRunner._best_effort_cancel(client, interface, accumulator.task_id)
        raise WorkflowExternalAgentRunError(
            "external_agent_cancelled",
            "External agent task was cancelled because the workflow stopped.",
        )

    @staticmethod
    def _best_effort_cancel(client: A2ARuntimeClient, interface: A2AAgentInterface, task_id: str) -> None:
        try:
            client.cancel_task(
                interface=interface,
                task_id=task_id,
                deadline_monotonic=time.monotonic() + 5.0,
            )
        except Exception:
            return

    @staticmethod
    def _raise_for_terminal_state(accumulator: _A2AResultAccumulator) -> None:
        state = accumulator.task_state
        if state is None or state == A2ATaskState.COMPLETED:
            return
        message = accumulator.status_message_text()
        if state == A2ATaskState.CANCELED:
            code = "external_agent_task_cancelled"
        elif state == A2ATaskState.INPUT_REQUIRED:
            code = "external_agent_input_required"
        elif state == A2ATaskState.AUTH_REQUIRED:
            code = "external_agent_auth_required"
        elif state == A2ATaskState.REJECTED:
            code = "external_agent_task_rejected"
        else:
            code = "external_agent_task_failed"
        raise WorkflowExternalAgentRunError(
            code,
            message or f"External agent task ended with state {state.value}.",
        )


class _A2AResultAccumulator:
    def __init__(self) -> None:
        self.task_id: str | None = None
        self.context_id: str | None = None
        self.task_state: A2ATaskState | None = None
        self.message: A2AMessage | None = None
        self.status_message: A2AMessage | None = None
        self.event_count = 0
        self._artifacts: dict[str, A2AArtifact] = {}
        self._artifact_order: list[str] = []

    @property
    def is_terminal(self) -> bool:
        return self.task_state is not None and self.task_state.terminal

    def consume_send_response(self, response: Any) -> None:
        self.event_count += 1
        if response.task is not None:
            self.consume_task(response.task, increment=False)
        elif response.message is not None:
            self.message = response.message
            self.task_id = response.message.task_id
            self.context_id = response.message.context_id

    def consume_stream(self, response: A2AStreamResponse) -> None:
        self.event_count += 1
        if response.task is not None:
            self.consume_task(response.task, increment=False)
        elif response.message is not None:
            self.message = response.message
            self.task_id = response.message.task_id or self.task_id
            self.context_id = response.message.context_id or self.context_id
        elif response.status_update is not None:
            status_update = response.status_update
            self.task_id = status_update.task_id
            self.context_id = status_update.context_id
            self.task_state = status_update.status.state
            self.status_message = status_update.status.message
        elif response.artifact_update is not None:
            artifact_update = response.artifact_update
            self.task_id = artifact_update.task_id
            self.context_id = artifact_update.context_id
            self._put_artifact(artifact_update.artifact, append=artifact_update.append)

    def consume_task(self, task: A2ATask, *, increment: bool = True) -> None:
        if increment:
            self.event_count += 1
        self.task_id = task.id
        self.context_id = task.context_id or self.context_id
        self.task_state = task.status.state
        self.status_message = task.status.message
        for artifact in task.artifacts:
            self._put_artifact(artifact, append=False)

    def _put_artifact(self, artifact: A2AArtifact, *, append: bool) -> None:
        if artifact.artifact_id not in self._artifacts:
            self._artifact_order.append(artifact.artifact_id)
        if append and artifact.artifact_id in self._artifacts:
            previous = self._artifacts[artifact.artifact_id]
            artifact = artifact.model_copy(update={"parts": [*previous.parts, *artifact.parts]})
        self._artifacts[artifact.artifact_id] = artifact

    def status_message_text(self) -> str:
        if self.status_message is None:
            return ""
        return "\n".join(part.text for part in self.status_message.parts if part.text).strip()

    def to_workflow_output(self, *, has_explicit_outputs: bool) -> dict[str, Any]:
        parts = [part for artifact_id in self._artifact_order for part in self._artifacts[artifact_id].parts]
        if not parts and self.message is not None:
            parts = list(self.message.parts)

        texts = [part.text for part in parts if part.text is not None]
        files = [{"transfer_method": "remote_url", "url": part.url} for part in parts if part.url is not None]
        data_values = [part.data for part in parts if part.data is not None]
        merged_data: dict[str, Any] = {}
        for value in data_values:
            if isinstance(value, Mapping):
                merged_data.update(value)

        text = "".join(texts).strip()
        parsed_text = self._parse_json_object(text)
        if parsed_text is not None:
            merged_data = {**parsed_text, **merged_data}
            text = ""

        if has_explicit_outputs or (merged_data and set(merged_data).intersection({"text", "files", "json"})):
            output = dict(merged_data)
        else:
            output = {"json": merged_data} if merged_data else {}
        if text and "text" not in output:
            output["text"] = text
        if files and "files" not in output:
            output["files"] = files
        if not output:
            output["text"] = ""
        return output

    @staticmethod
    def _parse_json_object(value: str) -> dict[str, Any] | None:
        if not value:
            return None
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return None
        return parsed if isinstance(parsed, dict) else None
