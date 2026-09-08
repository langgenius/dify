import pytest

from core.plugin.provider_identity import normalize_plugin_daemon_provider_identity
from models.provider_ids import ModelProviderID, ToolProviderID


def test_normalizes_stable_explicit_plugin_id() -> None:
    assert normalize_plugin_daemon_provider_identity(
        ModelProviderID("google"),
        "langgenius/google",
    ) == ("langgenius/google", "google")


def test_normalizes_versioned_explicit_plugin_unique_identifier() -> None:
    assert normalize_plugin_daemon_provider_identity(
        ModelProviderID("google"),
        "langgenius/google:0.4.2@checksum",
    ) == ("langgenius/google", "google")


def test_normalizes_legacy_explicit_provider_id_with_typed_alias_rules() -> None:
    assert normalize_plugin_daemon_provider_identity(
        ModelProviderID("langgenius/openai/openai"),
        "langgenius/openai/openai",
    ) == ("langgenius/openai", "openai")
    assert normalize_plugin_daemon_provider_identity(
        ModelProviderID("langgenius/google/google"),
        "langgenius/google/google",
    ) == ("langgenius/gemini", "google")
    assert normalize_plugin_daemon_provider_identity(
        ToolProviderID("langgenius/jina/jina"),
        "langgenius/jina/jina",
    ) == ("langgenius/jina_tool", "jina")


def test_rejects_malformed_explicit_plugin_id() -> None:
    with pytest.raises(ValueError, match="Invalid plugin id"):
        normalize_plugin_daemon_provider_identity(
            ModelProviderID("langgenius/openai/openai"),
            "langgenius/openai:0.4.2/extra",
        )


def test_derives_plugin_id_when_explicit_plugin_id_is_absent() -> None:
    assert normalize_plugin_daemon_provider_identity(ToolProviderID("langgenius/google/google")) == (
        "langgenius/google",
        "google",
    )


def test_preserves_typed_provider_alias_rules() -> None:
    assert normalize_plugin_daemon_provider_identity(ModelProviderID("google")) == (
        "langgenius/gemini",
        "google",
    )
    assert normalize_plugin_daemon_provider_identity(ToolProviderID("jina")) == (
        "langgenius/jina_tool",
        "jina",
    )
