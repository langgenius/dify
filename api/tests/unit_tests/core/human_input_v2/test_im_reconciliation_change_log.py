"""Domain-contract tests for append-only IM reconciliation changes."""

from __future__ import annotations

import dataclasses

from core.human_input_v2 import im_integration

_CHANGE_VALUE_TYPES = (
    im_integration.IMIdentityChangeSnapshot,
    im_integration.IMBindingChangeSnapshot,
    im_integration.IMReconciliationChange,
)

_FORBIDDEN_FIELD_FRAGMENTS = ("credential", "raw_payload", "client", "transport")


def test_change_log_values_are_immutable_and_contain_no_transport_material() -> None:
    field_names = {field.name for value_type in _CHANGE_VALUE_TYPES for field in dataclasses.fields(value_type)}
    assert not any(fragment in field_name for field_name in field_names for fragment in _FORBIDDEN_FIELD_FRAGMENTS)
    for value_type in _CHANGE_VALUE_TYPES:
        assert value_type.__dict__["__dataclass_params__"].frozen is True
        assert "__slots__" in value_type.__dict__
