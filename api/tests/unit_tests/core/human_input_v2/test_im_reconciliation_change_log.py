"""Domain-contract tests for append-only IM reconciliation changes."""

from __future__ import annotations

import dataclasses

from core.human_input_v2 import im_integration

_CHANGE_VALUE_NAMES = (
    "IMIdentityChangeSnapshot",
    "IMBindingChangeSnapshot",
    "IMReconciliationChange",
)

_FORBIDDEN_FIELD_FRAGMENTS = ("credential", "raw_payload", "client", "transport")


def test_change_log_values_are_immutable_and_contain_no_transport_material() -> None:
    missing_names = [name for name in _CHANGE_VALUE_NAMES if not hasattr(im_integration, name)]

    assert missing_names == []
    field_names = {
        field.name for name in _CHANGE_VALUE_NAMES for field in dataclasses.fields(getattr(im_integration, name))
    }
    assert not any(fragment in field_name for field_name in field_names for fragment in _FORBIDDEN_FIELD_FRAGMENTS)
    for name in _CHANGE_VALUE_NAMES:
        value_type = getattr(im_integration, name)
        assert value_type.__dataclass_params__.frozen is True
        assert "__slots__" in value_type.__dict__
