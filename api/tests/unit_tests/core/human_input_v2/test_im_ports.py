"""Shape tests for transaction-oriented IM persistence ports."""

from core.human_input_v2.im_integration import IMControlPlaneRepository


def test_repository_port_is_transaction_oriented_instead_of_table_crud() -> None:
    public_methods = {
        name for name, value in vars(IMControlPlaneRepository).items() if callable(value) and not name.startswith("_")
    }

    assert {
        "create_integration",
        "compare_and_swap_configuration",
        "compare_and_swap_delete",
        "create_or_get_active_run",
        "load_reconciliation_snapshot",
        "apply_reconciliation",
        "resolve_effective_binding",
        "append_sync_results",
    } <= public_methods
    assert not {"create", "read", "update", "delete"} & public_methods
