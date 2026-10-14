"""Exercise the API adapter offline without loading user settings or credentials."""

import copy
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import yaml
from dify_plugin.entities.model import AIModelEntity, ModelType
from dify_plugin.errors.model import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT.parent / "plugins/amdgpucloud"))

import amdgpucloud_remote  # noqa: E402
from model_catalog import (  # noqa: E402
    CatalogAuthorizationError,
    CatalogConnectionError,
    CatalogRateLimitError,
    CatalogUnavailableError,
    parse_catalog,
)


@pytest.fixture(autouse=True)
def graphon_contract_stubs(monkeypatch):
    """The real container integration separately validates these native entities."""
    monkeypatch.setitem(sys.modules, "graphon.model_runtime.entities.model_entities",
                        SimpleNamespace(AIModelEntity=AIModelEntity, ModelType=ModelType))
    monkeypatch.setitem(sys.modules, "graphon.model_runtime.errors.invoke", SimpleNamespace(
        InvokeAuthorizationError=InvokeAuthorizationError,
        InvokeBadRequestError=InvokeBadRequestError,
        InvokeConnectionError=InvokeConnectionError,
        InvokeRateLimitError=InvokeRateLimitError,
        InvokeServerUnavailableError=InvokeServerUnavailableError,
    ))


def schema(model):
    return parse_catalog({"data": [{
        "id": model,
        "architecture": {"input_modalities": ["text", "image"], "output_modalities": ["text"]},
        "context_length": 77777,
        "supported_parameters": ["max_tokens"],
    }]})[0]


class ProviderSchema(SimpleNamespace):
    def model_copy(self, deep=False):
        return copy.deepcopy(self) if deep else copy.copy(self)


def test_new_catalog_is_request_scoped_and_checks_existing_credential_policy(monkeypatch):
    original = ProviderSchema(provider="amdgpucloud/amdgpucloud/amdgpucloud", models=[])
    configuration = SimpleNamespace(
        tenant_id="tenant-a", provider=original,
        get_current_credentials=Mock(return_value={"api_key": "rc-synthetic"}),
    )
    get = Mock(return_value=[schema("never-baked-in-model")])
    monkeypatch.setattr(amdgpucloud_remote, "fetch_catalog", get)
    resolved = amdgpucloud_remote.resolve_provider_models(configuration, original)
    configuration.get_current_credentials.assert_called_once_with(ModelType.LLM, "")
    get.assert_called_once_with("rc-synthetic", scope="tenant-a:amdgpucloud/amdgpucloud/amdgpucloud")
    assert original.models == []
    assert resolved is not original
    assert resolved.models[0].model == "never-baked-in-model"
    assert configuration._cached_provider_schema is resolved


def test_no_credentials_returns_empty_catalog_without_external_requests(monkeypatch):
    original = ProviderSchema(provider="amdgpucloud/amdgpucloud/amdgpucloud", models=[])
    configuration = SimpleNamespace(
        tenant_id="tenant-a", provider=original, get_current_credentials=Mock(return_value=None),
    )
    get = Mock()
    monkeypatch.setattr(amdgpucloud_remote, "fetch_catalog", get)
    assert amdgpucloud_remote.resolve_provider_models(configuration, original).models == []
    get.assert_not_called()


def test_existing_schema_tracks_remote_changes_instead_of_static_one_hour_cache(monkeypatch):
    runtime = SimpleNamespace(tenant_id="tenant-a")
    get = Mock(side_effect=[[schema("new-model")], []])
    monkeypatch.setattr(amdgpucloud_remote, "fetch_catalog", get)
    result = amdgpucloud_remote.resolve_model_schema(
        runtime, "amdgpucloud/amdgpucloud/amdgpucloud", ModelType.LLM,
        "new-model", {"api_key": "rc-synthetic"},
    )
    assert result.model == "new-model"
    with pytest.raises(InvokeBadRequestError, match="current"):
        amdgpucloud_remote.resolve_model_schema(
            runtime, "amdgpucloud/amdgpucloud/amdgpucloud", ModelType.LLM,
            "new-model", {"api_key": "rc-synthetic"},
        )


@pytest.mark.parametrize("catalog_error,invoke_error", [
    (CatalogAuthorizationError, InvokeAuthorizationError),
    (CatalogConnectionError, InvokeConnectionError),
    (CatalogRateLimitError, InvokeRateLimitError),
    (CatalogUnavailableError, InvokeServerUnavailableError),
])
def test_native_error_types_never_echo_external_error_or_key(monkeypatch, catalog_error, invoke_error):
    monkeypatch.setattr(amdgpucloud_remote, "fetch_catalog", Mock(side_effect=catalog_error("private")))
    with pytest.raises(invoke_error) as error:
        amdgpucloud_remote._fetch("rc-synthetic", "tenant-a", "amdgpucloud/amdgpucloud/amdgpucloud")
    assert "private" not in str(error.value)
    assert "rc-synthetic" not in str(error.value)


def test_compatibility_does_not_intercept_other_model_providers():
    assert amdgpucloud_remote.uses_remote_catalog("amdgpucloud/amdgpucloud/amdgpucloud")
    assert amdgpucloud_remote.uses_remote_catalog("letian-kang/amdgpucloud/amdgpucloud")
    assert not amdgpucloud_remote.uses_remote_catalog("langgenius/openai/openai")


def test_standalone_compose_overlay_only_mounts_four_public_files_read_only():
    overlay = yaml.safe_load((ROOT / "compose.override.yaml").read_text())
    assert set(overlay["services"]) == {"api", "api_websocket", "worker", "worker_beat"}
    for service in overlay["services"].values():
        volumes = service["volumes"]
        assert len(volumes) == 4
        assert all(volume["type"] == "bind" and volume["read_only"] for volume in volumes)
        assert all(volume["source"].startswith("./compat/") for volume in volumes)
        assert all("docker.sock" not in volume["target"] for volume in volumes)