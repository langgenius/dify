"""Typed recording fakes shared by the KnowledgeFS controller tests.

Controllers reach KnowledgeFS through a runtime object whose components expose
plain methods. These fakes replace those components without mock objects:
``Recorder`` stores every call in a list and returns or raises what the test
configured, and ``FakeComponent`` exposes only the operations a test declares,
so an unexpected delegation fails with ``AttributeError``.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field


@dataclass(frozen=True)
class RecordedCall:
    args: tuple[object, ...] = ()
    kwargs: dict[str, object] = field(default_factory=dict)


def invocation(*args: object, **kwargs: object) -> RecordedCall:
    return RecordedCall(args=args, kwargs=kwargs)


class Recorder:
    """Callable test double that records calls and returns, raises or delegates.

    ``raises`` is raised on every call, ``results`` is consumed one value per
    call (exceptions in it are raised), and ``effect`` computes the result from
    the call arguments. Otherwise ``return_value`` is returned.
    """

    def __init__(
        self,
        return_value: object = None,
        *,
        raises: BaseException | None = None,
        results: Iterable[object] | None = None,
        effect: Callable[..., object] | None = None,
    ) -> None:
        self.return_value = return_value
        self.raises = raises
        self.effect = effect
        self._results: Iterator[object] | None = iter(results) if results is not None else None
        self.calls: list[RecordedCall] = []

    def __call__(self, *args: object, **kwargs: object) -> object:
        self.calls.append(RecordedCall(args=args, kwargs=kwargs))
        if self.raises is not None:
            raise self.raises
        if self._results is not None:
            result = next(self._results)
            if isinstance(result, BaseException):
                raise result
            return result
        if self.effect is not None:
            return self.effect(*args, **kwargs)
        return self.return_value

    @property
    def last_call(self) -> RecordedCall:
        assert self.calls, "expected at least one call"
        return self.calls[-1]

    @property
    def only_call(self) -> RecordedCall:
        assert len(self.calls) == 1, f"expected exactly one call, got {len(self.calls)}"
        return self.calls[0]


class FakeComponent:
    """Runtime component exposing exactly the named operations given to it."""

    def __init__(self, **operations: Recorder) -> None:
        self._operations = operations

    def __getattr__(self, name: str) -> Recorder:
        operations = self.__dict__.get("_operations", {})
        if name not in operations:
            raise AttributeError(name)
        return operations[name]


@dataclass
class FakeRuntime:
    """The subset of ``KnowledgeFSRuntime`` that controllers resolve per request."""

    facade: FakeComponent = field(default_factory=FakeComponent)
    application: FakeComponent = field(default_factory=FakeComponent)
    control_plane: FakeComponent = field(default_factory=FakeComponent)
    app_bindings: FakeComponent = field(default_factory=FakeComponent)
    broker: FakeComponent = field(default_factory=FakeComponent)
    service_api_authorization: FakeComponent = field(default_factory=FakeComponent)


def raising(error: BaseException) -> Callable[..., object]:
    """Return a plain callable that raises ``error`` when invoked."""

    def operation(*_args: object, **_kwargs: object) -> object:
        raise error

    return operation
