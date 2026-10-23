import pytest
from dify_trace_langsmith.config import LangSmithConfig
from pydantic import ValidationError

API_KEY = "lsv2_pt_test-key"
TENANT_ID = "4f1f0b4e-6a51-4c5a-9a8e-2d7f0c3b9e11"
PROJECT_ID = "0d9b8f61-2c3e-4b7a-8f5d-6e1a9c4b7d22"
PROJECT_URL = f"https://smith.langchain.com/o/{TENANT_ID}/projects/p/{PROJECT_ID}"


def test_config_declares_secret_and_derived_fields() -> None:
    assert LangSmithConfig.secret_fields() == {"api_key"}
    assert LangSmithConfig.derived_fields() == {"project_url"}
    assert [(field.name, field.secret, field.required) for field in LangSmithConfig.form_fields()] == [
        ("api_key", True, True),
        ("project", False, True),
        ("endpoint", False, False),
    ]


def test_config_reads_stored_values() -> None:
    stored = {"api_key": " lsv2_pt_stored ", "project": "dify-app", "endpoint": " ", "project_url": PROJECT_URL}
    config = LangSmithConfig.model_validate(stored)
    assert config.api_key == "lsv2_pt_stored"
    assert config.endpoint == "https://api.smith.langchain.com"
    assert config.project_url == PROJECT_URL


@pytest.mark.parametrize("endpoint", ["https://langsmith.internal/api", "https://langsmith.internal/api/v1"])
def test_config_keeps_the_endpoint_path(endpoint: str) -> None:
    assert LangSmithConfig(api_key=API_KEY, project="dify-app", endpoint=endpoint).endpoint == endpoint


@pytest.mark.parametrize(
    "fields",
    [
        {"project": "dify-app"},
        {"api_key": API_KEY},
        {"api_key": " ", "project": "dify-app"},
        {"api_key": API_KEY, "project": " "},
        {"api_key": API_KEY, "project": "dify-app", "endpoint": "http://langsmith.internal"},
        {"api_key": API_KEY, "project": "dify-app", "endpoint": "https://user:hunter2@langsmith.internal"},
    ],
)
def test_config_rejects_invalid_values_without_echoing_them(fields: dict[str, str]) -> None:
    with pytest.raises(ValidationError) as caught:
        LangSmithConfig.model_validate(fields)
    assert "hunter2" not in str(caught.value)
