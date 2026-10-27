import pytest
from dify_trace_mlflow.config import DatabricksConfig, MLflowConfig
from dify_trace_sdk.config import FormField
from pydantic import ValidationError


def test_mlflow_config_defaults_and_secrets() -> None:
    config = MLflowConfig()
    assert config.tracking_uri == "http://localhost:5000"
    assert config.experiment_id == "0"
    assert config.username is None
    assert config.password is None
    assert MLflowConfig(tracking_uri="  ").tracking_uri == "http://localhost:5000"
    assert MLflowConfig.secret_fields() == {"password"}
    assert MLflowConfig.derived_fields() == set()


def test_mlflow_config_reads_stored_configurations() -> None:
    config = MLflowConfig.model_validate(
        {
            "tracking_uri": " https://mlflow.example/proxy/ ",
            "experiment_id": " 42 ",
            "username": "admin",
            "password": "s3cret",
            "retired_field": "ignored",
        }
    )
    assert config.tracking_uri == "https://mlflow.example/proxy/"
    assert config.experiment_id == "42"
    assert (config.username, config.password) == ("admin", "s3cret")


@pytest.mark.parametrize(
    "tracking_uri", ["databricks", "databricks://profile", "ftp://mlflow.example", "https://admin:pw@mlflow.example"]
)
def test_mlflow_config_rejects_other_destinations(tracking_uri: str) -> None:
    with pytest.raises(ValidationError) as caught:
        MLflowConfig(tracking_uri=tracking_uri)
    assert "admin:pw" not in str(caught.value)


def test_experiment_ids_must_be_integers() -> None:
    with pytest.raises(ValidationError):
        MLflowConfig(experiment_id="experiment-1")
    with pytest.raises(ValidationError):
        DatabricksConfig(experiment_id="experiment-1", host="https://dbc.example")


def test_databricks_config_fields() -> None:
    config = DatabricksConfig.model_validate({"experiment_id": " 42 ", "host": "https://dbc.example"})
    assert config.experiment_id == "42"
    assert (config.client_id, config.client_secret, config.personal_access_token) == (None, None, None)
    assert DatabricksConfig.secret_fields() == {"client_secret", "personal_access_token"}
    assert DatabricksConfig.form_fields() == (
        FormField(name="experiment_id", secret=False, required=True),
        FormField(name="host", secret=False, required=True),
        FormField(name="client_id", secret=False, required=False),
        FormField(name="client_secret", secret=True, required=False),
        FormField(name="personal_access_token", secret=True, required=False),
    )
