from dataclasses import dataclass, field
from datetime import datetime

import pytest

from machinery.context import RequestContext
from services.data_source.binding_application_service import (
    BindingMutationResult,
    DataSourceBindingApplicationService,
    DataSourceBindingNotFoundError,
    DataSourceBindingStateError,
)
from services.entities.data_source.oauth import DataSourceBindingSummary


def _context() -> RequestContext:
    return RequestContext("request-1", None, "account-1", "workspace-1")


@dataclass
class InMemoryBindingStore:
    bindings: tuple[DataSourceBindingSummary, ...] = ()
    mutation_result: BindingMutationResult = "updated"
    changes: list[tuple[str, str, bool]] = field(default_factory=list)

    def list_enabled_bindings(self, *, workspace_id: str) -> tuple[DataSourceBindingSummary, ...]:
        assert workspace_id == "workspace-1"
        return self.bindings

    def change_disabled_state(
        self,
        *,
        workspace_id: str,
        binding_id: str,
        disabled: bool,
    ) -> BindingMutationResult:
        self.changes.append((workspace_id, binding_id, disabled))
        return self.mutation_result


def test_list_integrations_returns_secret_free_records() -> None:
    binding = DataSourceBindingSummary(
        id="binding-1",
        provider="notion",
        created_at=datetime(2026, 1, 1),
        disabled=False,
        source_info={"workspace_id": "notion-workspace"},
    )
    unsupported = DataSourceBindingSummary(
        id="binding-2",
        provider="unsupported",
        created_at=datetime(2026, 1, 1),
        disabled=False,
        source_info={},
    )
    service = DataSourceBindingApplicationService(bindings=InMemoryBindingStore(bindings=(binding, unsupported)))

    assert service.list_integrations(_context()) == (binding,)


@pytest.mark.parametrize(("operation", "disabled"), [("enable", False), ("disable", True)])
def test_change_state_passes_stable_context(operation: str, disabled: bool) -> None:
    store = InMemoryBindingStore()
    service = DataSourceBindingApplicationService(bindings=store)

    getattr(service, operation)(_context(), "binding-1")

    assert store.changes == [("workspace-1", "binding-1", disabled)]


@pytest.mark.parametrize(
    ("operation", "result", "error", "message"),
    [
        ("enable", "not_found", DataSourceBindingNotFoundError, "Data source binding not found"),
        ("enable", "already_enabled", DataSourceBindingStateError, "Data source is already enabled"),
        ("disable", "already_disabled", DataSourceBindingStateError, "Data source is already disabled"),
    ],
)
def test_change_state_translates_repository_outcomes(
    operation: str,
    result: BindingMutationResult,
    error: type[Exception],
    message: str,
) -> None:
    service = DataSourceBindingApplicationService(bindings=InMemoryBindingStore(mutation_result=result))

    with pytest.raises(error, match=message):
        getattr(service, operation)(_context(), "binding-1")
