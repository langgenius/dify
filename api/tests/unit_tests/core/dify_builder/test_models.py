"""Builder entry-mode wire values and per-instance mutable defaults."""

from core.dify_builder.models import (
    ChecklistError,
    EntryMode,
    NodeOutput,
    Run,
)


def test_entry_mode_values_are_verbatim_go_strings() -> None:
    assert EntryMode.FIX == "fix"
    assert EntryMode.FIX_CHECKLIST == "fix_checklist"


def test_checklist_error_default_factory_not_shared_between_instances() -> None:
    e1 = ChecklistError()
    e2 = ChecklistError()
    e1.messages.append("boom")
    assert e2.messages == []


def test_run_per_node_default_factory_not_shared_between_instances() -> None:
    r1 = Run()
    r2 = Run()
    r1.per_node.append(NodeOutput(node_id="n1"))
    assert r2.per_node == []
