import pytest
from dify_trace_langfuse.config import LangfuseConfig
from pydantic import ValidationError


def test_config_secrets_and_defaults() -> None:
    assert LangfuseConfig.secret_fields() == {"public_key", "secret_key"}
    assert LangfuseConfig.derived_fields() == {"project_key", "project_url"}
    assert LangfuseConfig(public_key="p", secret_key="s", host=" ").host == "https://api.langfuse.com"
    with pytest.raises(ValidationError):
        LangfuseConfig(public_key="p", secret_key="s", host="ftp://cloud.langfuse.com")


@pytest.mark.parametrize("project_url", ["javascript:alert(1)", "https://user:secret@langfuse.example/project/1"])
def test_stored_project_urls_must_be_safe_links(project_url: str) -> None:
    with pytest.raises(ValidationError):
        LangfuseConfig(public_key="p", secret_key="s", project_url=project_url)
