"""Ownership contracts for IM provider adapter consumers."""

from __future__ import annotations

from collections.abc import Callable
from typing import get_args, get_origin, get_type_hints

from core.human_input_v2.im_integration.adapters import IMProviderAdapter
from services.human_input_v2 import im_provider_configuration_service
from services.human_input_v2.im_contact_sync import composition, coordinator


def _callable_return_type(annotation: object) -> object:
    assert get_origin(annotation) is Callable
    _, return_type = get_args(annotation)
    return return_type


def test_external_adapter_factories_return_the_complete_adapter_contract() -> None:
    integration_factory_return = get_type_hints(composition.DifyIMIntegrationAdapterFactory.__call__)["return"]
    coordinator_factory = get_type_hints(coordinator.IMContactSyncCoordinator.__init__)["adapter_factory"]
    configuration_factory = get_type_hints(
        im_provider_configuration_service.DifyIMProviderConfigurationService.__init__
    )["adapter_factory"]

    assert integration_factory_return is IMProviderAdapter
    assert _callable_return_type(coordinator_factory) is IMProviderAdapter
    assert _callable_return_type(configuration_factory) is IMProviderAdapter


def test_external_modules_do_not_define_narrow_im_provider_adapter_protocols() -> None:
    assert not hasattr(coordinator, "IMContactSyncAdapter")
    assert not hasattr(coordinator, "IMIntegrationAdapterFactory")
    assert not hasattr(im_provider_configuration_service, "CredentialTestingAdapter")
