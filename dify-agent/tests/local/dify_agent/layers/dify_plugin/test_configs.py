import pytest
from pydantic import ValidationError

import dify_agent.layers.dify_plugin as dify_plugin_exports
from dify_agent.layers.dify_plugin import (
    DifyPluginCredentialValue,
    DifyPluginLLMLayerConfig,
    DifyPluginLayerConfig,
)


def test_dify_plugin_package_exports_client_safe_config_symbols_only() -> None:
    assert dify_plugin_exports.__all__ == [
        "DIFY_PLUGIN_LAYER_TYPE_ID",
        "DIFY_PLUGIN_LLM_LAYER_TYPE_ID",
        "DifyPluginCredentialValue",
        "DifyPluginLLMLayerConfig",
        "DifyPluginLayerConfig",
    ]
    assert dify_plugin_exports.DIFY_PLUGIN_LAYER_TYPE_ID == "dify.plugin"
    assert dify_plugin_exports.DIFY_PLUGIN_LLM_LAYER_TYPE_ID == "dify.plugin.llm"
    assert not hasattr(dify_plugin_exports, "DifyPluginLayer")
    assert not hasattr(dify_plugin_exports, "DifyPluginLLMLayer")


def test_dify_plugin_layer_config_forbids_runtime_settings() -> None:
    config = DifyPluginLayerConfig(tenant_id="tenant-1", plugin_id="plugin-1", user_id="user-1")

    assert config.tenant_id == "tenant-1"
    assert config.plugin_id == "plugin-1"
    assert config.user_id == "user-1"
    with pytest.raises(ValidationError):
        _ = DifyPluginLayerConfig.model_validate(
            {
                "tenant_id": "tenant-1",
                "plugin_id": "plugin-1",
                "daemon_url": "http://daemon",
            }
        )


def test_dify_plugin_llm_config_accepts_scalar_credentials_and_model_settings() -> None:
    credential: DifyPluginCredentialValue = "secret"
    config = DifyPluginLLMLayerConfig(
        model_provider="openai",
        model="gpt-4o-mini",
        credentials={"api_key": credential, "enabled": True, "retries": 2, "ratio": 0.5, "empty": None},
        model_settings={"temperature": 0.2, "max_tokens": 64},
    )

    assert config.model_provider == "openai"
    assert config.credentials == {"api_key": "secret", "enabled": True, "retries": 2, "ratio": 0.5, "empty": None}
    assert config.model_settings == {"temperature": 0.2, "max_tokens": 64}
    with pytest.raises(ValidationError):
        _ = DifyPluginLLMLayerConfig.model_validate(
            {
                "model_provider": "openai",
                "model": "gpt-4o-mini",
                "credentials": {"nested": {"not": "allowed"}},
            }
        )


def test_dify_plugin_llm_config_rejects_old_provider_field() -> None:
    with pytest.raises(ValidationError):
        _ = DifyPluginLLMLayerConfig.model_validate(
            {
                "provider": "openai",
                "model": "gpt-4o-mini",
            }
        )
