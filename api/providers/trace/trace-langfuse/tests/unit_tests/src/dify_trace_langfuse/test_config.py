import pytest
from dify_trace_langfuse.config import LangfuseConfig
from pydantic import ValidationError


def test_config_secrets_and_defaults() -> None:
    assert LangfuseConfig.secret_fields() == {"public_key", "secret_key"}
    assert LangfuseConfig.derived_fields() == {"project_key"}
    assert LangfuseConfig(public_key="p", secret_key="s", host=" ").host == "https://api.langfuse.com"
    with pytest.raises(ValidationError):
        LangfuseConfig(public_key="p", secret_key="s", host="ftp://cloud.langfuse.com")
