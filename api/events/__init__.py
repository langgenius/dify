"""Dify event package.

The package name intentionally stays as ``events`` for existing Dify imports. Some
third-party clients also import ``Events`` from a top-level ``events`` package, so
we expose a small compatible implementation to avoid import shadowing failures.
"""

from collections.abc import Callable, Iterator
from typing import Any


class EventsError(Exception):
    """Raised for invalid event slot operations."""


EventsException = EventsError


class _EventSlot:
    """A dynamically-created event slot supporting ``+=`` and call dispatch."""

    targets: list[Callable[..., Any]]
    __name__: str

    def __init__(self, name: str) -> None:
        self.targets = []
        self.__name__ = name

    def __call__(self, *args: Any, **kwargs: Any) -> None:
        for target in tuple(self.targets):
            target(*args, **kwargs)

    def __iadd__(self, target: Callable[..., Any]) -> "_EventSlot":
        self.targets.append(target)
        return self

    def __isub__(self, target: Callable[..., Any]) -> "_EventSlot":
        while target in self.targets:
            self.targets.remove(target)
        return self

    def __iter__(self) -> Iterator[Callable[..., Any]]:
        return iter(self.targets)

    def __len__(self) -> int:
        return len(self.targets)


class Events:
    """A minimal C#-style event container compatible with the external Events package."""

    _slots: dict[str, _EventSlot]

    def __init__(self, *event_names: str) -> None:
        self._slots = {}
        for event_name in event_names:
            self._slots[event_name] = _EventSlot(event_name)

    def __getattr__(self, name: str) -> _EventSlot:
        if name.startswith("_"):
            raise AttributeError(name)
        slot = _EventSlot(name)
        self._slots[name] = slot
        return slot


__all__ = ["Events", "EventsError", "EventsException"]
