"""Exercise collaboration metric startup through the existing OTel composition root."""

import os
import subprocess
import sys
from pathlib import Path
from textwrap import dedent


def test_init_instruments_registers_app_owned_collaboration_metrics_before_events() -> None:
    """Real instrumentors bind one app-owned instance and collect zero gauges before traffic.

    A child interpreter isolates gevent patching, SDK providers, and global instrumentors
    from other tests. SQLite supplies a real SQLAlchemy engine without external services.
    """
    script = dedent(
        """
        from gevent import monkey
        monkey.patch_all()

        from flask_sqlalchemy import SQLAlchemy
        from opentelemetry.metrics import set_meter_provider
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import Gauge, InMemoryMetricReader

        from dify_app import DifyApp
        from extensions.otel.instrumentation import init_instruments
        from extensions.otel.workflow_collaboration import WorkflowCollaborationMetrics

        app = DifyApp(__name__)
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        database = SQLAlchemy(app)
        reader = InMemoryMetricReader()
        provider = MeterProvider(metric_readers=[reader])
        set_meter_provider(provider)
        try:
            init_instruments(app)
            metrics = app.extensions["workflow_collaboration_metrics"]
            assert isinstance(metrics, WorkflowCollaborationMetrics)
            assert [
                extension for extension in app.extensions.values()
                if isinstance(extension, WorkflowCollaborationMetrics)
            ] == [metrics]

            data = reader.get_metrics_data()
            assert data is not None
            exported = {
                metric.name: metric
                for resource in data.resource_metrics
                for scope in resource.scope_metrics
                for metric in scope.metrics
                if metric.name.startswith("dify.collaboration.")
            }
            assert set(exported) == {
                "dify.collaboration.connections",
                "dify.collaboration.rooms",
                "dify.collaboration.room_sessions",
            }
            for name in ("connections", "rooms"):
                gauge = exported[f"dify.collaboration.{name}"].data
                assert isinstance(gauge, Gauge)
                assert len(gauge.data_points) == 1
                assert gauge.data_points[0].value == 0
                assert gauge.data_points[0].attributes == {"aggregation_scope": "worker"}
            distribution = exported["dify.collaboration.room_sessions"].data
            assert isinstance(distribution, Gauge)
            assert len(distribution.data_points) == 5
            assert {point.attributes["size_range"]: point.value for point in distribution.data_points} == {
                "1": 0, "2-5": 0, "6-10": 0, "11-20": 0, "21+": 0
            }
        finally:
            provider.shutdown()
            with app.app_context():
                database.engine.dispose()
        """
    )
    completed = subprocess.run(
        [sys.executable, "-B", "-c", script],
        cwd=Path(__file__).resolve().parents[4],
        env={**os.environ, "DEBUG": "false", "ENABLE_OTEL": "true"},
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
