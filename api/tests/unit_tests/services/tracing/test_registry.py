from collections.abc import Iterator
from importlib.metadata import EntryPoint

import pytest

from services.tracing import registry
from services.tracing.registry import (
    ENTRY_POINT_GROUP,
    SUPPORTED_PROVIDERS,
    TraceProviderUnavailableError,
    UnknownTraceProviderError,
    installed_providers,
    provider_class,
)


@pytest.fixture(autouse=True)
def fresh_registry() -> Iterator[None]:
    provider_class.cache_clear()
    yield
    provider_class.cache_clear()


def test_every_supported_provider_is_installed_under_its_own_id() -> None:
    assert installed_providers() == SUPPORTED_PROVIDERS
    for provider_id in SUPPORTED_PROVIDERS:
        assert provider_class(provider_id).id == provider_id


def test_unknown_providers_are_client_errors() -> None:
    with pytest.raises(UnknownTraceProviderError):
        provider_class("datadog")


@pytest.mark.parametrize(
    "entry_points",
    [
        {},
        {"langfuse": EntryPoint(name="langfuse", value="not_a_trace_package:Provider", group=ENTRY_POINT_GROUP)},
        {
            "langfuse": EntryPoint(
                name="langfuse", value="dify_trace_opik.provider:OpikProvider", group=ENTRY_POINT_GROUP
            )
        },
        {"langfuse": EntryPoint(name="langfuse", value="dify_trace_sdk.ids:span_id_for", group=ENTRY_POINT_GROUP)},
    ],
    ids=["not-installed", "import-fails", "wrong-provider", "not-a-provider"],
)
def test_supported_providers_that_do_not_load_are_unavailable(
    monkeypatch: pytest.MonkeyPatch, entry_points: dict[str, EntryPoint]
) -> None:
    monkeypatch.setattr(registry, "_entry_points", lambda: entry_points)

    with pytest.raises(TraceProviderUnavailableError):
        provider_class("langfuse")
    assert "langfuse" not in installed_providers()
