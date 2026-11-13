"""Architecture tests for the pure IM reconciliation planner contract."""

from __future__ import annotations

import ast
import dataclasses
import inspect

from core.human_input_v2.im_integration import sync_reconciliation

_COMPOSITE_VALUE_TYPES = (
    sync_reconciliation.ReconciliationRunRef,
    sync_reconciliation.CurrentIMIdentityState,
    sync_reconciliation.ContactEmailMatchState,
    sync_reconciliation.CurrentIMBindingState,
    sync_reconciliation.ReconciliationInput,
    sync_reconciliation.ExistingIMIdentityRef,
    sync_reconciliation.NewIMIdentityRef,
    sync_reconciliation.IMIdentityUpsert,
    sync_reconciliation.CreateIMBinding,
    sync_reconciliation.ReplaceIMBinding,
    sync_reconciliation.DeleteIMBinding,
    sync_reconciliation.IMIdentityDeletion,
    sync_reconciliation.PlannedSyncResult,
    sync_reconciliation.PlannedReconciliationWarning,
    sync_reconciliation.ReconciliationPlan,
    sync_reconciliation.ReconciliationBlock,
    sync_reconciliation.BlockedReconciliation,
)

_FORBIDDEN_IMPORT_PREFIXES = (
    "flask",
    "sqlalchemy",
    "controllers",
    "repositories",
    "services",
)

_FORBIDDEN_PUBLIC_FIELD_FRAGMENTS = (
    "credential",
    "workspace",
    "edition",
    "binding_scope",
    "raw_payload",
)


def test_planner_exposes_immutable_composite_plan_values() -> None:
    for value_type in _COMPOSITE_VALUE_TYPES:
        parameters = value_type.__dict__["__dataclass_params__"]
        assert parameters.frozen is True
        assert "__slots__" in value_type.__dict__


def test_planner_imports_no_transport_or_infrastructure_layer() -> None:
    source = inspect.getsource(sync_reconciliation)
    tree = ast.parse(source)
    imported_modules = {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
    imported_modules.update(
        node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and node.module is not None
    )

    assert not any(
        module == prefix or module.startswith(f"{prefix}.")
        for module in imported_modules
        for prefix in _FORBIDDEN_IMPORT_PREFIXES
    )


def test_planner_public_values_do_not_expose_scope_or_transport_material() -> None:
    public_field_names = {
        field.name for value_type in _COMPOSITE_VALUE_TYPES for field in dataclasses.fields(value_type)
    }

    assert not any(
        fragment in field_name for field_name in public_field_names for fragment in _FORBIDDEN_PUBLIC_FIELD_FRAGMENTS
    )
