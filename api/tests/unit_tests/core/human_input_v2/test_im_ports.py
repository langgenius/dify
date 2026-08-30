"""Shape tests for transaction-oriented IM persistence ports."""

from core.human_input_v2.im_integration import IMControlPlaneRepository, IMSyncRepository


def test_repository_port_is_transaction_oriented_instead_of_table_crud() -> None:
    sync_methods = {
        name for name, value in vars(IMSyncRepository).items() if callable(value) and not name.startswith("_")
    }
    control_plane_methods = {
        name for name, value in vars(IMControlPlaneRepository).items() if callable(value) and not name.startswith("_")
    }

    assert {
        "load_current_integration",
        "create_or_get_active_run",
        "load_sync_run",
        "load_latest_sync_run",
        "page_sync_results",
        "search_identities",
    } <= sync_methods
    assert {
        "create_integration",
        "compare_and_swap_configuration",
        "compare_and_swap_delete",
        "append_sync_results",
    } <= control_plane_methods
    assert not {
        "create",
        "read",
        "update",
        "delete",
        "load_reconciliation_snapshot",
        "apply_reconciliation",
    } & (sync_methods | control_plane_methods)
