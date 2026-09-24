from __future__ import annotations

import asyncio
import os
from typing import ClassVar, cast

import logfire
import pytest
from fastapi import FastAPI
from opentelemetry.sdk.trace.sampling import ALWAYS_ON, ParentBased
from opentelemetry.trace import NoOpTracerProvider

import dify_agent.server.observability as observability
from dify_agent.runtime.observability import AgentObservability
from dify_agent.server.observability import configure_server_observability
from dify_agent.server.settings import ServerSettings


@pytest.fixture(autouse=True)
def isolate_observability_environment(monkeypatch, tmp_path):
    # The temporary working directory hides a developer's dotenv, while stripping
    # the SDK and DIFY_AGENT_* variables hides exported ones. Cases that exercise
    # a dotenv or a specific variable write it themselves after this runs.
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(os, "environ", dict(os.environ))
    for key in tuple(os.environ):
        if key.startswith(("OTEL_", "LOGFIRE_", "DIFY_AGENT_")):
            monkeypatch.delenv(key)


_FAKE_NATIVE_PROVIDER = NoOpTracerProvider()


class _FakeLogfireConfig:
    @staticmethod
    def get_tracer_provider() -> NoOpTracerProvider:
        return _FAKE_NATIVE_PROVIDER


class FakeLogfireModule:
    SamplingOptions: ClassVar[type] = logfire.SamplingOptions
    config: ClassVar[_FakeLogfireConfig] = _FakeLogfireConfig()
    configure_calls: ClassVar[list[dict[str, object]]] = []
    configure_envs: ClassVar[list[dict[str, str]]] = []
    fastapi_calls: ClassVar[list[dict[str, object]]] = []
    httpx_calls: ClassVar[list[dict[str, object]]] = []
    redis_calls: ClassVar[list[dict[str, object]]] = []
    pydantic_ai_calls: ClassVar[list[dict[str, object]]] = []

    @classmethod
    def reset(cls) -> None:
        cls.configure_calls.clear()
        cls.configure_envs.clear()
        cls.fastapi_calls.clear()
        cls.httpx_calls.clear()
        cls.redis_calls.clear()
        cls.pydantic_ai_calls.clear()

    @classmethod
    def configure(cls, **kwargs: object) -> "type[FakeLogfireModule]":
        cls.configure_calls.append(kwargs)
        cls.configure_envs.append(
            {key: value for key, value in os.environ.items() if key.startswith(("OTEL_", "LOGFIRE_"))}
        )
        return cls

    @classmethod
    def instrument_fastapi(cls, app: FastAPI, **kwargs: object) -> None:
        cls.fastapi_calls.append({"app": app, **kwargs})

    @classmethod
    def instrument_httpx(cls, **kwargs: object) -> None:
        cls.httpx_calls.append(kwargs)

    @classmethod
    def instrument_redis(cls, **kwargs: object) -> None:
        cls.redis_calls.append(kwargs)

    @classmethod
    def instrument_pydantic_ai(cls, **kwargs: object) -> None:
        cls.pydantic_ai_calls.append(kwargs)


def test_configure_server_observability_keeps_remote_export_token_gated_by_logfire_env(monkeypatch) -> None:
    FakeLogfireModule.reset()
    monkeypatch.setattr(observability, "logfire", FakeLogfireModule)
    monkeypatch.setattr(observability, "_global_instrumentation_ready", False)
    app = FastAPI()

    platform = configure_server_observability(app)

    assert platform is FakeLogfireModule
    assert FakeLogfireModule.configure_calls == [
        {
            "send_to_logfire": "if-token-present",
            "inspect_arguments": False,
        }
    ]
    assert FakeLogfireModule.configure_envs == [{}]


def test_configure_server_observability_instruments_server_boundaries_once(monkeypatch) -> None:
    FakeLogfireModule.reset()
    monkeypatch.setattr(observability, "logfire", FakeLogfireModule)
    monkeypatch.setattr(observability, "_global_instrumentation_ready", False)
    first_app = FastAPI()
    second_app = FastAPI()

    configure_server_observability(first_app)
    configure_server_observability(second_app)

    expected_provider = observability.IsolatedTracerProvider(FakeLogfireModule, preserve_external_parent=True)
    assert FakeLogfireModule.httpx_calls == [
        {
            "capture_all": False,
            "capture_headers": False,
            "capture_request_body": False,
            "capture_response_body": False,
            "tracer_provider": expected_provider,
        }
    ]
    assert FakeLogfireModule.redis_calls == [{"capture_statement": False, "tracer_provider": expected_provider}]
    assert FakeLogfireModule.pydantic_ai_calls == []
    assert FakeLogfireModule.fastapi_calls == [
        {
            "app": first_app,
            "request_attributes_mapper": observability._platform_request_attributes,
            "capture_headers": False,
            "tracer_provider": expected_provider,
        },
        {
            "app": second_app,
            "request_attributes_mapper": observability._platform_request_attributes,
            "capture_headers": False,
            "tracer_provider": expected_provider,
        },
    ]
    assert first_app.state.dify_agent_logfire_instrumented is True
    assert second_app.state.dify_agent_logfire_instrumented is True


def test_configure_server_observability_shared_mode_uses_native_tracer_provider(monkeypatch) -> None:
    FakeLogfireModule.reset()
    monkeypatch.setattr(observability, "logfire", FakeLogfireModule)
    monkeypatch.setattr(observability, "_global_instrumentation_ready", False)
    monkeypatch.setattr(observability, "_global_trace_context_mode", None)
    app = FastAPI()

    configure_server_observability(app, settings=ServerSettings(trajectory_trace_context_mode="shared"))

    assert FakeLogfireModule.httpx_calls == [
        {
            "capture_all": False,
            "capture_headers": False,
            "capture_request_body": False,
            "capture_response_body": False,
            "tracer_provider": _FAKE_NATIVE_PROVIDER,
        }
    ]
    assert FakeLogfireModule.redis_calls == [{"capture_statement": False, "tracer_provider": _FAKE_NATIVE_PROVIDER}]
    assert FakeLogfireModule.fastapi_calls == [
        {
            "app": app,
            "request_attributes_mapper": observability._platform_request_attributes,
            "capture_headers": False,
            "tracer_provider": _FAKE_NATIVE_PROVIDER,
        }
    ]
    assert FakeLogfireModule.pydantic_ai_calls == []


def test_configure_server_observability_reads_trace_context_mode_from_environment(monkeypatch) -> None:
    FakeLogfireModule.reset()
    monkeypatch.setattr(observability, "logfire", FakeLogfireModule)
    monkeypatch.setattr(observability, "_global_instrumentation_ready", False)
    monkeypatch.setattr(observability, "_global_trace_context_mode", None)
    monkeypatch.setenv("DIFY_AGENT_TRAJECTORY_TRACE_CONTEXT_MODE", "shared")

    configure_server_observability(FastAPI())

    assert FakeLogfireModule.httpx_calls[0]["tracer_provider"] is _FAKE_NATIVE_PROVIDER


def test_configure_server_observability_rejects_trace_context_mode_change(monkeypatch) -> None:
    FakeLogfireModule.reset()
    monkeypatch.setattr(observability, "logfire", FakeLogfireModule)
    monkeypatch.setattr(observability, "_global_instrumentation_ready", False)
    monkeypatch.setattr(observability, "_global_trace_context_mode", None)

    configure_server_observability(FastAPI(), settings=ServerSettings(trajectory_trace_context_mode="isolated"))

    with pytest.raises(ValueError, match="Trace context mode cannot change"):
        configure_server_observability(FastAPI(), settings=ServerSettings(trajectory_trace_context_mode="shared"))
    assert len(FakeLogfireModule.configure_calls) == 1

    configure_server_observability(FastAPI(), settings=ServerSettings(trajectory_trace_context_mode="isolated"))
    assert len(FakeLogfireModule.configure_calls) == 2


@pytest.mark.parametrize("dotenv_path", [".env", "dify-agent/.env"])
def test_configure_server_observability_forwards_otel_logfire_from_dotenv(
    monkeypatch, tmp_path, dotenv_path: str
) -> None:
    FakeLogfireModule.reset()
    monkeypatch.setattr(observability, "logfire", FakeLogfireModule)
    monkeypatch.setattr(observability, "_global_instrumentation_ready", False)
    dotenv_file = tmp_path / dotenv_path
    dotenv_file.parent.mkdir(parents=True, exist_ok=True)
    dotenv_file.write_text(
        'OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:4318"\n'
        'OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer test-only"\n'
        "LOGFIRE_SERVICE_NAME=dify-agent-test\n"
        'OTEL_RESOURCE_ATTRIBUTES="service.namespace=dify,deployment.environment.name=local"\n'
        "UNRELATED_SECRET=not-forwarded\n"
        "DIFY_AGENT_API_TOKEN=not-forwarded\n"
        "OTLP_API_KEY=not-forwarded\n"
        "NOT_OTEL_VALUE=not-forwarded\n"
        "OTELISH=not-forwarded\n"
        "OTEL_UNSET\n"
        "LOGFIRE_EMPTY=\n"
    )

    configure_server_observability(FastAPI())

    assert FakeLogfireModule.configure_envs == [
        {
            "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:4318",
            "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer test-only",
            "LOGFIRE_SERVICE_NAME": "dify-agent-test",
            "OTEL_RESOURCE_ATTRIBUTES": "service.namespace=dify,deployment.environment.name=local",
            "LOGFIRE_EMPTY": "",
        }
    ]
    for key in (
        "UNRELATED_SECRET",
        "DIFY_AGENT_API_TOKEN",
        "OTLP_API_KEY",
        "NOT_OTEL_VALUE",
        "OTELISH",
        "OTEL_UNSET",
    ):
        assert key not in os.environ


def test_configure_server_observability_later_dotenv_file_wins(monkeypatch, tmp_path) -> None:
    FakeLogfireModule.reset()
    monkeypatch.setattr(observability, "logfire", FakeLogfireModule)
    monkeypatch.setattr(observability, "_global_instrumentation_ready", False)
    (tmp_path / ".env").write_text("OTEL_EXPORTER_OTLP_ENDPOINT=http://root:4318\nLOGFIRE_SERVICE_NAME=root\n")
    nested_dir = tmp_path / "dify-agent"
    nested_dir.mkdir()
    (nested_dir / ".env").write_text("OTEL_EXPORTER_OTLP_ENDPOINT=http://nested:4318\n")

    configure_server_observability(FastAPI())

    assert FakeLogfireModule.configure_envs == [
        {
            "OTEL_EXPORTER_OTLP_ENDPOINT": "http://nested:4318",
            "LOGFIRE_SERVICE_NAME": "root",
        }
    ]


@pytest.mark.parametrize("existing_endpoint", ["http://existing:4318", ""])
def test_configure_server_observability_process_env_wins_and_is_idempotent(
    monkeypatch, tmp_path, existing_endpoint: str
) -> None:
    FakeLogfireModule.reset()
    monkeypatch.setattr(observability, "logfire", FakeLogfireModule)
    monkeypatch.setattr(observability, "_global_instrumentation_ready", False)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", existing_endpoint)
    monkeypatch.setenv("LOGFIRE_SERVICE_NAME", "existing-service")
    (tmp_path / ".env").write_text(
        "OTEL_EXPORTER_OTLP_ENDPOINT=http://dotenv:4318\n"
        "LOGFIRE_SERVICE_NAME=dotenv-service\n"
        "OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf\n"
    )

    configure_server_observability(FastAPI())
    configure_server_observability(FastAPI())

    expected = {
        "OTEL_EXPORTER_OTLP_ENDPOINT": existing_endpoint,
        "LOGFIRE_SERVICE_NAME": "existing-service",
        "OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
    }
    assert FakeLogfireModule.configure_envs == [expected, expected]
    assert os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] == existing_endpoint


@pytest.mark.parametrize("use_custom_file", [True, False])
def test_configure_server_observability_reads_configured_env_file_paths(
    monkeypatch, tmp_path, use_custom_file: bool
) -> None:
    FakeLogfireModule.reset()
    monkeypatch.setattr(observability, "logfire", FakeLogfireModule)
    monkeypatch.setattr(observability, "_global_instrumentation_ready", False)
    (tmp_path / ".env").write_text("LOGFIRE_SERVICE_NAME=default-dotenv\n")
    if use_custom_file:
        custom_file = tmp_path / "custom.env"
        custom_file.write_text("LOGFIRE_SERVICE_NAME=custom-dotenv\n")
        monkeypatch.setitem(ServerSettings.model_config, "env_file", custom_file)
    else:
        monkeypatch.setitem(ServerSettings.model_config, "env_file", None)

    configure_server_observability(FastAPI())

    if use_custom_file:
        assert FakeLogfireModule.configure_envs == [{"LOGFIRE_SERVICE_NAME": "custom-dotenv"}]
    else:
        assert FakeLogfireModule.configure_envs == [{}]


class FakeOTLPSpanExporter:
    calls: ClassVar[list[dict[str, object]]] = []
    shutdown_called: bool

    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs
        self.shutdown_called = False
        type(self).calls.append(kwargs)

    def shutdown(self) -> None:
        self.shutdown_called = True


class FakeBatchSpanProcessor:
    calls: ClassVar[list[dict[str, object]]] = []
    instances: ClassVar[list["FakeBatchSpanProcessor"]] = []
    exporter: FakeOTLPSpanExporter
    shutdown_called: bool

    def __init__(self, exporter: FakeOTLPSpanExporter, **kwargs: object) -> None:
        self.exporter = exporter
        self.kwargs = kwargs
        self.shutdown_called = False
        type(self).calls.append(kwargs)
        type(self).instances.append(self)

    def shutdown(self) -> None:
        self.shutdown_called = True


class RaisingLogfireModule(FakeLogfireModule):
    @classmethod
    def configure(cls, **_kwargs: object) -> "type[RaisingLogfireModule]":
        cls.configure_calls.append(_kwargs)
        raise RuntimeError("configure failed")


def _patch_agent_observability_dependencies(monkeypatch, logfire_module=FakeLogfireModule) -> None:
    logfire_module.reset()
    FakeOTLPSpanExporter.calls.clear()
    FakeBatchSpanProcessor.calls.clear()
    monkeypatch.setattr(observability, "logfire", logfire_module)
    monkeypatch.setattr(observability, "OTLPSpanExporter", FakeOTLPSpanExporter)
    monkeypatch.setattr(observability, "BatchSpanProcessor", FakeBatchSpanProcessor)
    FakeBatchSpanProcessor.instances.clear()


def _enabled_trajectory_settings(**overrides: object) -> ServerSettings:
    values: dict[str, object] = {
        "trajectory_enabled": True,
        "trajectory_otlp_traces_endpoint": "http://127.0.0.1:4318/v1/traces",
    }
    values.update(overrides)
    return ServerSettings.model_validate(values)


def test_configure_agent_observability_disabled_creates_no_sdk_or_exporter(monkeypatch) -> None:
    _patch_agent_observability_dependencies(monkeypatch)
    settings = _enabled_trajectory_settings(trajectory_enabled=False)

    assert observability.configure_agent_observability(settings) is None
    assert FakeLogfireModule.configure_calls == []
    assert FakeOTLPSpanExporter.calls == []
    assert FakeBatchSpanProcessor.calls == []


def test_configure_agent_observability_missing_endpoint_fails_before_sdk_setup(monkeypatch) -> None:
    _patch_agent_observability_dependencies(monkeypatch)
    settings = _enabled_trajectory_settings()
    settings.trajectory_otlp_traces_endpoint = None

    with pytest.raises(ValueError, match="trajectory_otlp_traces_endpoint"):
        observability.configure_agent_observability(settings)
    assert FakeLogfireModule.configure_calls == []
    assert FakeOTLPSpanExporter.calls == []


def test_configure_agent_observability_builds_independent_pipeline_without_inherited_env(monkeypatch) -> None:
    _patch_agent_observability_dependencies(monkeypatch)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://platform:4318")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "http://platform:4318/v1/traces")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=platform-test-only")
    monkeypatch.setenv("LOGFIRE_TOKEN", "platform-test-only")
    settings = _enabled_trajectory_settings(
        trajectory_otlp_headers={"Authorization": "agent-test-only"},
        trajectory_service_name="dify-agent-trajectory",
        trajectory_include_content=True,
    )

    result = observability.configure_agent_observability(settings)

    assert isinstance(result, AgentObservability)
    assert result.client is FakeLogfireModule
    assert result.include_content is True
    assert FakeOTLPSpanExporter.calls == [
        {
            "endpoint": "http://127.0.0.1:4318/v1/traces",
            "headers": {"Authorization": "agent-test-only"},
            "timeout": 5,
        }
    ]
    assert FakeBatchSpanProcessor.calls == [
        {
            "max_queue_size": 2048,
            "max_export_batch_size": 512,
            "schedule_delay_millis": 5000,
            "export_timeout_millis": 5000,
        }
    ]
    configure_kwargs = FakeLogfireModule.configure_calls[0]
    assert configure_kwargs["local"] is True
    assert configure_kwargs["send_to_logfire"] is False
    assert configure_kwargs["service_name"] == "dify-agent-trajectory"
    assert configure_kwargs["console"] is False
    assert configure_kwargs["metrics"] is False
    assert configure_kwargs["inspect_arguments"] is False
    assert configure_kwargs["add_baggage_to_attributes"] is False
    assert configure_kwargs["sampling"] is not None
    assert configure_kwargs["sampling"].head is ALWAYS_ON
    assert result.trace_context_mode == "isolated"
    assert FakeLogfireModule.configure_envs == [{}]
    assert os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] == "http://platform:4318"
    assert os.environ["OTEL_EXPORTER_OTLP_HEADERS"] == "Authorization=platform-test-only"
    assert os.environ["LOGFIRE_TOKEN"] == "platform-test-only"


def test_configure_agent_observability_shared_mode_uses_parent_based_sampling(monkeypatch) -> None:
    _patch_agent_observability_dependencies(monkeypatch)
    settings = _enabled_trajectory_settings(
        trajectory_trace_context_mode="shared",
        trajectory_include_content=True,
    )

    result = observability.configure_agent_observability(settings)

    assert isinstance(result, AgentObservability)
    assert result.trace_context_mode == "shared"
    assert result.include_content is True
    configure_kwargs = FakeLogfireModule.configure_calls[0]
    assert isinstance(configure_kwargs["sampling"].head, ParentBased)


@pytest.mark.parametrize("mode", ["isolated", "shared"])
def test_configure_agent_observability_disabled_ignores_trace_context_mode(monkeypatch, mode: str) -> None:
    _patch_agent_observability_dependencies(monkeypatch)
    settings = _enabled_trajectory_settings(trajectory_enabled=False, trajectory_trace_context_mode=mode)

    assert observability.configure_agent_observability(settings) is None
    assert FakeLogfireModule.configure_calls == []
    assert FakeOTLPSpanExporter.calls == []


def test_configure_agent_observability_passes_batch_processor_limits_to_processor(monkeypatch) -> None:
    _patch_agent_observability_dependencies(monkeypatch)
    settings = _enabled_trajectory_settings(
        trajectory_max_queue_size=1024,
        trajectory_max_export_batch_size=128,
        trajectory_schedule_delay_ms=250,
        trajectory_export_timeout_ms=1500,
    )

    observability.configure_agent_observability(settings)

    assert FakeBatchSpanProcessor.calls == [
        {
            "max_queue_size": 1024,
            "max_export_batch_size": 128,
            "schedule_delay_millis": 250,
            "export_timeout_millis": 1500,
        }
    ]
    assert FakeOTLPSpanExporter.calls[0]["timeout"] == 5


def test_configure_agent_observability_empty_headers_do_not_inherit_platform_auth(monkeypatch) -> None:
    _patch_agent_observability_dependencies(monkeypatch)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=platform-test-only")

    observability.configure_agent_observability(_enabled_trajectory_settings())

    assert FakeOTLPSpanExporter.calls[0]["headers"] == {}
    assert os.environ["OTEL_EXPORTER_OTLP_HEADERS"] == "Authorization=platform-test-only"


def test_configure_agent_observability_restores_env_and_shuts_processor_on_configure_failure(
    monkeypatch,
) -> None:
    _patch_agent_observability_dependencies(monkeypatch, logfire_module=RaisingLogfireModule)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://platform:4318")

    with pytest.raises(RuntimeError, match="configure failed"):
        observability.configure_agent_observability(_enabled_trajectory_settings())

    assert len(FakeBatchSpanProcessor.instances) == 1
    assert FakeBatchSpanProcessor.instances[0].shutdown_called is True
    assert os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] == "http://platform:4318"


class FakeAgentLogfireClient:
    def __init__(self) -> None:
        self.shutdown_calls: list[dict[str, object]] = []

    def shutdown(self, **kwargs: object) -> None:
        self.shutdown_calls.append(kwargs)


def test_agent_observability_aclose_shuts_down_only_the_agent_client() -> None:
    client = FakeAgentLogfireClient()
    instance = AgentObservability(client=cast(logfire.Logfire, client))

    asyncio.run(instance.aclose())

    assert client.shutdown_calls == [{"timeout_millis": 5000}]
