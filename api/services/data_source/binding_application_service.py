"""Application service for managing data-source OAuth bindings."""

from collections.abc import Sequence
from typing import Literal, Protocol

from machinery.context import RequestContext
from services.entities.data_source.oauth import DataSourceBindingSummary

type BindingMutationResult = Literal["updated", "not_found", "already_enabled", "already_disabled"]

_SUPPORTED_PROVIDERS = frozenset({"notion"})


class DataSourceBindingStore(Protocol):
    def list_enabled_bindings(self, *, workspace_id: str) -> Sequence[DataSourceBindingSummary]: ...

    def change_disabled_state(
        self,
        *,
        workspace_id: str,
        binding_id: str,
        disabled: bool,
    ) -> BindingMutationResult: ...


class DataSourceBindingError(Exception):
    """Base class for framework-neutral binding management failures."""


class DataSourceBindingNotFoundError(DataSourceBindingError):
    def __init__(self) -> None:
        super().__init__("Data source binding not found")


class DataSourceBindingStateError(DataSourceBindingError):
    def __init__(self, *, disabled: bool) -> None:
        state = "disabled" if disabled else "enabled"
        super().__init__(f"Data source is already {state}")


class DataSourceBindingApplicationService:
    def __init__(self, *, bindings: DataSourceBindingStore) -> None:
        self._bindings = bindings

    def list_integrations(self, context: RequestContext) -> tuple[DataSourceBindingSummary, ...]:
        return tuple(
            binding
            for binding in self._bindings.list_enabled_bindings(workspace_id=context.active_workspace_id)
            if binding.provider in _SUPPORTED_PROVIDERS
        )

    def enable(self, context: RequestContext, binding_id: str) -> None:
        self._change_state(context, binding_id, disabled=False)

    def disable(self, context: RequestContext, binding_id: str) -> None:
        self._change_state(context, binding_id, disabled=True)

    def _change_state(self, context: RequestContext, binding_id: str, *, disabled: bool) -> None:
        result = self._bindings.change_disabled_state(
            workspace_id=context.active_workspace_id,
            binding_id=binding_id,
            disabled=disabled,
        )
        if result == "updated":
            return
        if result == "not_found":
            raise DataSourceBindingNotFoundError()
        raise DataSourceBindingStateError(disabled=disabled)
