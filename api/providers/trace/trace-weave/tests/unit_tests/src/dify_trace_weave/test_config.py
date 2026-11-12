import pytest
from dify_trace_weave.config import WeaveConfig
from pydantic import ValidationError


def test_config_fields_and_defaults() -> None:
    assert WeaveConfig.secret_fields() == {"api_key"}
    assert WeaveConfig.derived_fields() == set()
    assert [field.name for field in WeaveConfig.form_fields()] == ["api_key", "entity", "project", "endpoint", "host"]
    stored = WeaveConfig.model_validate(
        {"api_key": "k", "entity": None, "project": "demo", "endpoint": " ", "host": "", "project_url": "ignored"}
    )
    assert (stored.entity, stored.endpoint, stored.host) == (None, "https://trace.wandb.ai", None)
    private = WeaveConfig(
        api_key="k", project="demo", endpoint="https://wandb.internal/traces/", host="http://wandb.internal/wandb"
    )
    assert (private.endpoint, private.host) == ("https://wandb.internal/traces/", "http://wandb.internal/wandb")
    for incomplete in ({"api_key": "k"}, {"project": "demo"}):
        with pytest.raises(ValidationError):
            WeaveConfig.model_validate(incomplete)


@pytest.mark.parametrize(
    ("field", "url"),
    [
        ("endpoint", "http://trace.internal"),
        ("host", "ftp://wandb.internal"),
        ("host", "https://user:secret@wandb.internal"),
        ("endpoint", "https://trace.internal/?token=secret"),
        ("host", "https://wandb.internal/#secret"),
        ("host", "https://wandb.internal/se cret"),
        ("endpoint", "https://trace.internal\\secret"),
        ("host", "https://wandb.internal:secret"),
    ],
)
def test_config_rejects_unusable_urls_without_echoing_them(field: str, url: str) -> None:
    with pytest.raises(ValidationError) as caught:
        WeaveConfig.model_validate({"api_key": "k", "project": "demo", field: url})
    assert "secret" not in str(caught.value)
