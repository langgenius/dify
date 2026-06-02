import pytest
from pydantic import ValidationError

import dify_agent.layers.shell as shell_exports
from dify_agent.layers.shell import DIFY_SHELL_LAYER_TYPE_ID, DifyShellLayerConfig


def test_shell_package_exports_client_safe_config_symbols_only() -> None:
    assert shell_exports.__all__ == ["DIFY_SHELL_LAYER_TYPE_ID", "DifyShellLayerConfig"]
    assert DIFY_SHELL_LAYER_TYPE_ID == "dify.shell"
    assert not hasattr(shell_exports, "DifyShellLayer")


def test_shell_layer_config_is_empty_and_forbids_unknown_fields() -> None:
    config = DifyShellLayerConfig()

    assert config.model_dump() == {}

    with pytest.raises(ValidationError):
        _ = DifyShellLayerConfig.model_validate({"entrypoint": "http://shellctl"})
