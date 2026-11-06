import pytest
from dify_trace_opik.config import OpikConfig
from dify_trace_sdk.config import FormField
from pydantic import ValidationError

API_URL = "https://www.comet.com/opik/api/"


def test_config_fields_and_defaults() -> None:
    assert OpikConfig.secret_fields() == {"api_key"}
    assert OpikConfig.derived_fields() == frozenset()
    assert OpikConfig.form_fields() == (
        FormField(name="api_key", secret=True, required=False),
        FormField(name="project", secret=False, required=False),
        FormField(name="workspace", secret=False, required=False),
        FormField(name="url", secret=False, required=False),
    )
    stored = OpikConfig.model_validate({"api_key": None, "project": None, "workspace": " ", "url": ""})
    assert (stored.api_key, stored.project, stored.workspace, stored.url) == (None, "Default Project", None, API_URL)
    named = OpikConfig(project=" Dify ", workspace=" team-1 ", url=" http://localhost:5173/api/ ")
    assert (named.project, named.workspace, named.url) == ("Dify", "team-1", "http://localhost:5173/api/")


@pytest.mark.parametrize(
    ("url", "message"),
    [
        ("ftp://comet.example.com/api/", "URL must start with https:// or http://"),
        ("https://comet.example.com/opik/", "URL should end with /api/"),
        ("https://user:secret@comet.example.com/api/", "URL must name a host and must not contain credentials"),
    ],
)
def test_config_rejects_unusable_urls_without_echoing_them(url: str, message: str) -> None:
    with pytest.raises(ValidationError, match=message) as caught:
        OpikConfig(url=url)
    assert "secret" not in str(caught.value)
