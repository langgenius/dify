"""Production composition contracts for IM Integration management."""

from types import SimpleNamespace

import pytest

from services.human_input_v2 import im_integration_management_composition as composition


def test_management_composition_injects_only_the_key_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    sentinel_engine = object()
    sentinel_key_provider = object()
    sentinel_repository = object()
    sentinel_unit_of_work_factory = object()
    captured: dict[str, object] = {}

    class _ConfigurationService:
        def __init__(self, *, key_provider: object) -> None:
            captured["key_provider"] = key_provider

    class _ManagementService:
        def __init__(self, repository: object, provider_port: object) -> None:
            captured["repository"] = repository
            captured["provider_port"] = provider_port

    monkeypatch.setattr(composition, "db", SimpleNamespace(engine=sentinel_engine))
    monkeypatch.setattr(composition, "key_provider_manager", SimpleNamespace(provider=sentinel_key_provider))

    def build_unit_of_work_factory(operation_sessions: object) -> object:
        captured["operation_sessions"] = operation_sessions
        return sentinel_unit_of_work_factory

    monkeypatch.setattr(
        composition,
        "_build_im_write_unit_of_work_factory",
        build_unit_of_work_factory,
    )
    monkeypatch.setattr(
        composition,
        "SQLAlchemyIMControlPlaneRepository",
        lambda _sessions, unit_of_work_factory: (
            sentinel_repository
            if unit_of_work_factory is sentinel_unit_of_work_factory
            else AssertionError("unexpected unit of work factory")
        ),
    )
    monkeypatch.setattr(composition, "DifyIMProviderConfigurationService", _ConfigurationService)
    monkeypatch.setattr(composition, "HumanInputIMIntegrationManagementService", _ManagementService)

    service = composition.build_human_input_im_integration_management_service()

    assert isinstance(service, _ManagementService)
    assert captured["key_provider"] is sentinel_key_provider
    assert captured["repository"] is sentinel_repository
    assert isinstance(captured["provider_port"], _ConfigurationService)
