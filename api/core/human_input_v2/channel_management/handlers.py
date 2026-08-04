"""Handler protocol and duplicate-safe registry for supported channels."""

from __future__ import annotations

from typing import Protocol

from .commands import DeleteChannelCommand, SaveChannelCommand, TestChannelCommand
from .contracts import (
    ChannelCapability,
    ChannelOperationResult,
    ChannelRef,
    HumanInputChannelManagementContext,
)


class ChannelHandler(Protocol):
    """One channel handler registered for exactly one complete channel ref."""

    ref: ChannelRef
    capabilities: frozenset[ChannelCapability]

    def get(self, context: HumanInputChannelManagementContext) -> ChannelOperationResult: ...

    def test(
        self,
        context: HumanInputChannelManagementContext,
        command: TestChannelCommand,
    ) -> ChannelOperationResult: ...

    def save(
        self,
        context: HumanInputChannelManagementContext,
        command: SaveChannelCommand,
    ) -> ChannelOperationResult: ...

    def delete(
        self,
        context: HumanInputChannelManagementContext,
        command: DeleteChannelCommand,
    ) -> ChannelOperationResult: ...


class DuplicateChannelHandlerError(ValueError):
    """Raised when two handlers claim one kind/provider combination."""


class ChannelHandlerRegistry:
    """Registry keyed by one complete channel ref per handler."""

    _handlers: dict[ChannelRef, ChannelHandler]

    def __init__(self, handlers: tuple[ChannelHandler, ...] = ()) -> None:
        self._handlers = {}
        for handler in handlers:
            self.register(handler)

    def register(self, handler: ChannelHandler) -> None:
        if handler.ref in self._handlers:
            raise DuplicateChannelHandlerError(
                f"handler already registered for {handler.ref.kind.value}/{handler.ref.provider.value}"
            )
        self._handlers[handler.ref] = handler

    def resolve(self, ref: ChannelRef) -> ChannelHandler | None:
        return self._handlers.get(ref)

    def handlers(self) -> tuple[ChannelHandler, ...]:
        return tuple(self._handlers[ref] for ref in sorted(self._handlers, key=lambda item: (item.kind, item.provider)))
