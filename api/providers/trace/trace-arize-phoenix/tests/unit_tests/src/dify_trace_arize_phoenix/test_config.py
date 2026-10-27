import pytest
from dify_trace_arize_phoenix.config import ArizeConfig, PhoenixConfig
from pydantic import ValidationError

SPACE = "U3BhY2U6dGVzdA=="


def test_phoenix_key_is_an_optional_secret() -> None:
    assert PhoenixConfig.secret_fields() == {"api_key"}
    assert PhoenixConfig.derived_fields() == set()
    assert [(field.name, field.secret, field.required) for field in PhoenixConfig.form_fields()] == [
        ("api_key", True, False),
        ("project", False, False),
        ("endpoint", False, False),
    ]
    config = PhoenixConfig()
    assert (config.api_key, config.project, config.endpoint) == (None, "default", "https://app.phoenix.arize.com")


def test_arize_credentials_are_required_secrets_and_the_destination_is_derived() -> None:
    assert ArizeConfig.secret_fields() == {"api_key", "space_id"}
    assert ArizeConfig.derived_fields() == {"arize_project_destination"}
    assert [(field.name, field.secret, field.required) for field in ArizeConfig.form_fields()] == [
        ("api_key", True, True),
        ("space_id", True, True),
        ("project", False, False),
        ("endpoint", False, False),
    ]
    config = ArizeConfig(api_key="key", space_id=SPACE)
    assert (config.project, config.endpoint, config.arize_project_destination) == (
        "default",
        "https://otlp.arize.com",
        None,
    )
    with pytest.raises(ValidationError):
        ArizeConfig.model_validate({"api_key": "key"})


@pytest.mark.parametrize(("project", "expected"), [(None, "default"), ("", "default"), ("  ", "default"), (" p ", "p")])
def test_empty_projects_fall_back_to_default(project: str | None, expected: str) -> None:
    assert PhoenixConfig.model_validate({"project": project}).project == expected
    assert ArizeConfig.model_validate({"api_key": "key", "space_id": SPACE, "project": project}).project == expected


def test_phoenix_endpoint_keeps_its_path() -> None:
    assert PhoenixConfig(endpoint=" https://phoenix.example.com/s/space/ ").endpoint == (
        "https://phoenix.example.com/s/space/"
    )
    assert PhoenixConfig(endpoint=" ").endpoint == "https://app.phoenix.arize.com"


def test_arize_endpoint_is_reduced_to_the_collector_origin() -> None:
    def endpoint(value: str) -> str:
        return ArizeConfig(api_key="key", space_id=SPACE, endpoint=value).endpoint

    assert endpoint("https://otlp.eu-west-1a.arize.com/v1/") == "https://otlp.eu-west-1a.arize.com"
    assert endpoint("http://collector.internal:4317") == "http://collector.internal:4317"
    assert endpoint("") == "https://otlp.arize.com"


@pytest.mark.parametrize(
    "endpoint", ["ftp://collector.example.com", "collector.example.com", "https://user:hunter2@collector.example.com"]
)
def test_invalid_endpoints_are_rejected_without_echoing_them(endpoint: str) -> None:
    for model, values in ((PhoenixConfig, {}), (ArizeConfig, {"api_key": "key", "space_id": SPACE})):
        with pytest.raises(ValidationError) as caught:
            model.model_validate({**values, "endpoint": endpoint})
        assert "hunter2" not in str(caught.value)


def test_stored_rows_still_load() -> None:
    phoenix = PhoenixConfig.model_validate(
        {"api_key": None, "project": None, "endpoint": "https://app.phoenix.arize.com", "project_url": "https://x"}
    )
    assert (phoenix.project, phoenix.endpoint) == ("default", "https://app.phoenix.arize.com")

    destination = {
        "endpoint": "https://otlp.arize.com",
        "space_id": SPACE,
        "project": "exact",
        "organization_id": "T3JnOnRlc3Q=",
        "project_id": "UHJvamVjdDovKz0=",
        "source_digest": "0" * 64,
    }
    arize = ArizeConfig.model_validate(
        {
            "api_key": "key",
            "space_id": SPACE,
            "project": "exact",
            "endpoint": "https://otlp.arize.com",
            "arize_project_destination": destination,
            "project_url": "https://app.arize.com/organizations/forged",
        }
    )
    assert arize.arize_project_destination == destination
    assert "project_url" not in arize.model_dump()
