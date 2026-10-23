"""One worker process serves many tenants, so nothing may outlive or leak across a call."""

import ast
import base64
import os
from pathlib import Path
from urllib.parse import urlsplit

import dify_trace_mlflow
from dify_trace_mlflow.config import DatabricksConfig, MLflowConfig
from dify_trace_mlflow.provider import DatabricksProvider, MLflowProvider
from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.testing import RecordingEgress, message_trace, response

ACK = EgressResponse(status_code=200, headers={"content-type": "application/x-protobuf"}, content=b"")
CREDENTIALS = response(
    200, {"credential_info": {"signed_uri": "https://storage.example/data?sig=signature", "type": "GCP_SIGNED_URL"}}
)
STORED = response(200, b"")
ALLOWED_IMPORTS = {
    "base64",
    "collections",
    "dify_trace_mlflow",
    "dify_trace_sdk",
    "google",
    "json",
    "mlflow",
    "opentelemetry",
    "pydantic",
    "re",
    "typing",
    "urllib",
}
ALLOWED_MLFLOW_IMPORTS = (
    "mlflow.entities",
    "mlflow.protos.",
    "mlflow.store.tracking.rest_store",
    "mlflow.tracing.constant",
    "mlflow.tracing.utils.otlp",
    "mlflow.utils.rest_utils",
)


def _basic(username: str, password: str) -> str:
    return "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()


def _experiment(experiment_id: str) -> EgressResponse:
    return response(200, {"experiment": {"experiment_id": experiment_id, "lifecycle_stage": "active"}})


def _started(trace_id: str) -> EgressResponse:
    return response(200, {"trace": {"trace_info": {"trace_id": trace_id}}})


def test_tenants_in_one_process_keep_their_own_credentials_and_leave_the_environment_alone() -> None:
    environment = dict(os.environ)
    token = response(200, {"access_token": "oauth-token-c", "token_type": "Bearer"})
    egress = RecordingEgress(
        [
            *(_experiment("1"), ACK, _experiment("2"), ACK),
            *(token, _experiment("3"), token, _started("tr-c"), CREDENTIALS, STORED),
            *(_experiment("4"), _started("tr-d"), CREDENTIALS, STORED),
        ],
        grpc_target=None,
    )
    mlflow_provider = MLflowProvider(egress)
    databricks_provider = DatabricksProvider(egress)

    for mlflow_config in (
        MLflowConfig(tracking_uri="https://a.example", experiment_id="1", username="tenant-a", password="password-a"),
        MLflowConfig(tracking_uri="https://b.example", experiment_id="2"),
    ):
        mlflow_provider.send(mlflow_provider.verify(mlflow_config), message_trace())
    for databricks_config in (
        DatabricksConfig(experiment_id="3", host="https://c.example", client_id="client-c", client_secret="secret-c"),
        DatabricksConfig(experiment_id="4", host="https://d.example", personal_access_token="pat-d"),
    ):
        databricks_provider.send(databricks_provider.verify(databricks_config), message_trace())

    assert dict(os.environ) == environment
    authorization: dict[str, set[str | None]] = {}
    for sent in egress.requests:
        authorization.setdefault(urlsplit(sent.url).netloc, set()).add(sent.headers.get("Authorization"))
    assert authorization == {
        "a.example": {_basic("tenant-a", "password-a")},
        "b.example": {None},
        "c.example": {_basic("client-c", "secret-c"), "Bearer oauth-token-c"},
        "d.example": {"Bearer pat-d"},
        "storage.example": {None},
    }


def test_the_package_imports_nothing_from_the_application_or_the_process() -> None:
    for path in Path(dify_trace_mlflow.__file__).parent.glob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                modules = [node.module or ""]
            else:
                continue
            for module in modules:
                assert module.split(".")[0] in ALLOWED_IMPORTS, f"{path.name} imports {module}"
                if module.startswith("mlflow"):
                    assert module.startswith(ALLOWED_MLFLOW_IMPORTS), f"{path.name} imports {module}"
