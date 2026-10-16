"""Process-local guard for concrete native diagnostic adapters, never authority.

The eventual trusted host supplies a qualified frozen server policy and its real
synchronous failure latch. A failure cannot be treated as persistence ACK just
because Graphon catches a layer exception. No operational data or raw exception
is passed to the callback, and no callback runs under this guard's local lock.
"""

from collections.abc import Callable, Generator, Mapping
from contextlib import contextmanager
from inspect import isasyncgenfunction, iscoroutinefunction
from threading import Event, Lock, get_ident
from types import CoroutineType
from typing import Any, NoReturn, overload

from core.workflow.system_variables import SystemVariableKey
from graphon.entities import WorkflowStartReason
from graphon.graph_events import GraphEngineEvent, GraphRunStartedEvent
from services.dify_builder.native_testing.observation_privacy import NativeHttpObservationPolicy


class NativeObservationError(RuntimeError):
    """Only fixed safe diagnostics leave a failed observation adapter."""

    def __init__(self) -> None:
        super().__init__("native_observation_failed")


class NativeObservationGuard:
    """Sticky failure plus independent projections for actual trusted adapters.

    This is neither admission nor a durable receipt. The host must still reject
    any failed guard, verify protected ownership/profile/currentness and retain
    actual physical handles. Notification completion is only a local callback
    attempt, including a failed callback; it never proves host persistence ACK.
    """

    def __init__(self, *, policy: NativeHttpObservationPolicy, on_failure: Callable[[], None]) -> None:
        invalid = False
        try:
            invalid = (
                type(policy) is not NativeHttpObservationPolicy
                or not callable(on_failure)
                or iscoroutinefunction(on_failure)
                or isasyncgenfunction(on_failure)
                or iscoroutinefunction(on_failure.__call__)
                or isasyncgenfunction(on_failure.__call__)
            )
        except BaseException:
            invalid = True
        if invalid:
            raise NativeObservationError() from None
        self._policy = policy
        self._on_failure = on_failure
        self._lock = Lock()
        self._failed = False
        self._failure_thread: int | None = None
        self._notification_finished = Event()

    @property
    def failed(self) -> bool:
        with self._lock:
            return self._failed

    def require_healthy(self) -> None:
        if self.failed:
            self.fail()

    def fail(self) -> NoReturn:
        """Latch before notifying once; all callers get the same safe refusal.

        Concurrent failing observers wait for the synchronous callback attempt
        to finish, without holding the local lock. Reentrant callbacks cannot
        deadlock; callback errors/invalid returns never restore success. This is
        no timeout, lease, dispatch fence or durable failure acknowledgment.
        """
        caller = get_ident()
        with self._lock:
            first = not self._failed
            if first:
                self._failed = True
                self._failure_thread = caller
        if first:
            try:
                result = self._on_failure()
                if isinstance(result, CoroutineType):
                    result.close()
            except BaseException:
                # Discard callback returns/errors without retaining or rendering payloads.
                result = None
            finally:
                self._notification_finished.set()
        elif self._failure_thread != caller:
            self._notification_finished.wait()
        raise NativeObservationError() from None

    @contextmanager
    def persistence_scope(self) -> Generator[None]:
        """Catch every marked owner failure without retaining/rendering payloads."""
        self.require_healthy()
        failed = False
        try:
            yield
        except BaseException:
            failed = True
        if failed:
            self.fail()
        self.require_healthy()

    def event(self, event: GraphEngineEvent) -> GraphEngineEvent:
        with self.persistence_scope():
            return self._policy.event(event)

    def persistence_event(self, event: GraphEngineEvent) -> GraphEngineEvent:
        """No old row/history is accepted without trusted projection provenance.

        The existing get_by_workflow_execution contract has none. Refuse before
        the layer can save a resumed Run or load any old rows into its cache.
        Ordinary resumption remains outside this opt-in guard.
        """
        with self.persistence_scope():
            if type(event) is GraphRunStartedEvent and event.reason is WorkflowStartReason.RESUMPTION:
                self.fail()
            return self._policy.event(event)

    def graph(self, graph: Mapping[str, Any]) -> dict[str, Any]:
        with self.persistence_scope():
            return self._policy.graph(graph)

    @overload
    def values(self, values: None) -> None: ...

    @overload
    def values(self, values: Mapping[str, Any]) -> dict[str, Any]: ...

    def values(self, values: Mapping[str, Any] | None) -> dict[str, Any] | None:
        with self.persistence_scope():
            return self._policy.values(values)

    @overload
    def error(self, error: None) -> None: ...

    @overload
    def error(self, error: BaseException | str) -> str: ...

    def error(self, error: BaseException | str | None) -> str | None:
        with self.persistence_scope():
            return self._policy.error(error)

    def workflow_inputs(self, *, inputs: Mapping[str, Any], system_variables: Mapping[str, Any]) -> dict[str, Any]:
        """Match ordinary initial/system selection before safe value projection."""
        with self.persistence_scope():
            # Validate plain keys before formatting the native sys.* namespace;
            # no arbitrary key/object rendering or ordinary value converter.
            self._policy.values(inputs)
            self._policy.values(system_variables)
            combined = dict(inputs)
            for name, value in system_variables.items():
                if name != SystemVariableKey.CONVERSATION_ID.value:
                    combined[f"sys.{name}"] = value
            return self._policy.values(combined)

    def workflow_execution_id(self, system_variables: Mapping[str, Any]) -> str:
        """Retain a real typed Run ID, never convert an arbitrary object to str."""
        with self.persistence_scope():
            self._policy.values(system_variables)
            value = system_variables.get(SystemVariableKey.WORKFLOW_EXECUTION_ID.value)
            if type(value) is not str or not value or len(value) > 512:
                self.fail()
            return value
