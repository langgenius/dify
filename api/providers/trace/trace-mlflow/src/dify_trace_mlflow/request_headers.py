"""Capture built-in headers and instantiate MLflow header plugins for one export."""

import logging
import os
from importlib import import_module, metadata
from typing import Any

from core.ops.provider_export import TraceExportError


def _capture_databricks_headers() -> dict[str, str]:
    """Read the native runtime's notebook/job metadata before crossing the queue."""
    command: Any = None
    try:
        repl = import_module("dbruntime.databricks_repl_context").get_context()
    except Exception:
        repl = None
    try:
        shell = import_module("IPython").get_ipython()
        dbutils = shell.ns_table["user_global"]["dbutils"]
        command = dbutils.notebook.entry_point.getDbutils().notebook().getContext()
    except Exception:
        command = None

    def read_runtime_field(name: str) -> Any:
        if repl is not None and hasattr(repl, name):
            # Databricks REPL fields vary across runtime versions.
            return getattr(repl, name)  # guard-ignore: no-new-getattr -- runtime-selected Databricks metadata field
        try:
            return getattr(command, name)().get()  # guard-ignore: no-new-getattr -- Databricks Java metadata method
        except Exception:
            try:
                tag = command.tags().get(name)
                return tag.get() if tag.isDefined() else None
            except Exception:
                return None

    notebook_id = read_runtime_field("notebookId")
    if repl is None or not hasattr(repl, "notebookId"):
        try:
            task = import_module("pyspark").TaskContext.get()
            notebook_id = task.getLocalProperty("spark.databricks.notebook.id") if task else None
        except Exception:
            notebook_id = None
        if not notebook_id:
            path = read_runtime_field("aclPathOfAclRoot")
            if path is None:
                try:
                    path = command.extraContext().get("aclPathOfAclRoot").get()
                except Exception:
                    path = None
            if path and path.startswith("/workspace"):
                notebook_id = path.split("/")[-1]
    cluster_id = read_runtime_field("clusterId")
    if repl is None or not hasattr(repl, "clusterId"):
        try:
            spark_class = import_module("pyspark.sql").SparkSession
            try:
                spark = spark_class.getActiveSession()
            except Exception:
                spark = spark_class._instantiatedSession
            cluster_id = spark.conf.get("spark.databricks.clusterUsageTags.clusterId", None) if spark else None
        except Exception:
            cluster_id = None
    in_notebook = repl.isInNotebook if repl is not None and hasattr(repl, "isInNotebook") else notebook_id is not None
    in_job = (
        repl.isInJob
        if repl is not None and hasattr(repl, "isInJob")
        else read_runtime_field("jobId") is not None and read_runtime_field("idInJob") is not None
    )
    in_cluster = repl.isInCluster if repl is not None and hasattr(repl, "isInCluster") else cluster_id is not None
    headers = {}
    if in_notebook:
        headers["notebook_id"] = notebook_id
    if in_job:
        headers.update(
            job_id=read_runtime_field("jobId"),
            job_run_id=read_runtime_field("idInJob"),
            job_type=read_runtime_field("jobTaskType"),
        )
    if in_cluster:
        headers["cluster_id"] = cluster_id
    if in_notebook or in_job or in_cluster:
        headers.update(workload_id=read_runtime_field("workloadId"), workload_class=read_runtime_field("workloadClass"))
    return {key: item for key, item in headers.items() if item is not None}


def _capture_entrypoint_identity(entrypoint: metadata.EntryPoint) -> dict[str, str | None]:
    distribution = entrypoint.dist
    return {
        "entrypoint": entrypoint.name,
        "value": entrypoint.value,
        "distribution": distribution.metadata["Name"] if distribution else None,
        "version": distribution.version if distribution else None,
    }


def capture_request_headers() -> dict[str, Any]:
    """Capture plugin identity without invoking its per-request credential methods."""
    providers = []
    try:
        for entrypoint in metadata.entry_points(group="mlflow.request_header_provider"):
            try:
                entrypoint.load()()
            except (AttributeError, ImportError):
                logging.getLogger(__name__).warning("Cannot load MLflow request header plugin")
                continue
            providers.append(_capture_entrypoint_identity(entrypoint))
    except Exception:
        raise ValueError("Cannot resolve MLflow request header plugins") from None
    return {
        "headers": {
            **_capture_databricks_headers(),
            "User-Agent": "mlflow-python-client/3.11.1",
            "X-MLflow-Client-Version": "3.11.1",
        },
        "providers": providers,
        "traffic_id": os.environ.get("_MLFLOW_DATABRICKS_TRAFFIC_ID"),
    }


class MLflowRequestHeaders:
    def __init__(self, settings: dict[str, Any]):
        self.headers = dict(settings.get("headers", {}))
        self.traffic_id = settings.get("traffic_id")
        self.providers = []
        selections = settings.get("providers", [])
        if not selections:
            return
        try:
            installed = metadata.entry_points(group="mlflow.request_header_provider")
            for selection in selections:
                for entrypoint in installed:
                    if _capture_entrypoint_identity(entrypoint) == selection:
                        self.providers.append(entrypoint.load()())
                        break
                else:
                    raise TraceExportError("mlflow_header_plugin_changed")
        except TraceExportError:
            raise
        except Exception:
            raise TraceExportError("mlflow_header_plugin_unavailable") from None

    def resolve(self) -> dict[str, str]:
        headers = dict(self.headers)
        for provider in self.providers:
            try:
                if provider.in_context():
                    for key, value in provider.request_headers().items():
                        headers[key] = f"{headers[key]} {value}" if key in headers else value
            except Exception:
                # Native MLflow skips failed providers; never log their credential-bearing errors.
                logging.getLogger(__name__).warning("Cannot resolve MLflow request headers")
        if self.traffic_id:
            headers["x-databricks-traffic-id"] = self.traffic_id
        return headers
