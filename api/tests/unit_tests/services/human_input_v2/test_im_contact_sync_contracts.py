"""Ownership contracts for IM provider adapter consumers."""

from __future__ import annotations

from collections.abc import Callable
from typing import TypeAliasType, get_args, get_origin, get_type_hints

from core.human_input_v2.im_integration.adapters import IMProviderAdapter
from services.human_input_v2.im_contact_sync import composition, coordinator


def _callable_return_type(annotation: object) -> object:
    if isinstance(annotation, TypeAliasType):
        annotation = annotation.__value__
    assert get_origin(annotation) is Callable
    _, return_type = get_args(annotation)
    return return_type


def test_external_adapter_factories_return_the_complete_adapter_contract() -> None:
    channel_factory_return = get_type_hints(composition.DifyIMChannelAdapterFactory.__call__)["return"]
    reconciliation_factory = get_type_hints(coordinator.IMChannelReconciliationService.__init__)["adapter_factory"]

    assert channel_factory_return is IMProviderAdapter
    assert _callable_return_type(reconciliation_factory) is IMProviderAdapter
