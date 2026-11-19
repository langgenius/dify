import traceback

import pytest
from dify_trace_aliyun.config import AliyunConfig
from dify_trace_sdk.config import FormField
from pydantic import ValidationError

ENDPOINT = "http://tracing-analysis-dc-qd.aliyuncs.com"
EMBEDDED_KEY = "DO-NOT-PRINT"


def _config(**overrides: object) -> AliyunConfig:
    return AliyunConfig.model_validate({"endpoint": ENDPOINT, "license_key": "synthetic-key", **overrides})


def _rendered(error: ValidationError) -> str:
    return str(error) + repr(error) + "".join(traceback.format_exception(error))


def test_form_declares_the_license_key_as_the_only_secret() -> None:
    assert AliyunConfig.secret_fields() == {"license_key"}
    assert AliyunConfig.derived_fields() == set()
    assert AliyunConfig.form_fields() == (
        FormField(name="app_name", secret=False, required=False),
        FormField(name="license_key", secret=True, required=True),
        FormField(name="endpoint", secret=False, required=True),
    )


def test_stored_configuration_validates_unchanged() -> None:
    stored = {
        "app_name": "test_app",
        "license_key": "test_license_key",
        "endpoint": "https://custom.tracing-analysis-dc-hz.aliyuncs.com",
    }
    config = AliyunConfig.model_validate({**stored, "retired_field": "ignored"})
    assert config.model_dump() == stored
    assert AliyunConfig.model_validate(config.model_dump()) == config


def test_normalization_keeps_the_license_key_and_application_name_opaque() -> None:
    config = _config(
        endpoint=" HTTPS://Project.CN-QINGDAO.LOG.ALIYUNCS.COM:443/apm/trace/opentelemetry/ ",
        app_name=" 中文 agent_Name 01 ",
        license_key="literal%2F@a+b/c",
    )
    assert config.endpoint == "https://project.cn-qingdao.log.aliyuncs.com:443/apm/trace/opentelemetry"
    assert config.app_name == "中文 agent_Name 01"
    assert config.license_key == "literal%2F@a+b/c"


@pytest.mark.parametrize("name", ["", "  ", "dify_app", "应用 & Space"])
def test_empty_application_names_fall_back_to_the_default(name: str) -> None:
    assert _config(app_name=name).app_name == (name.strip() or "dify_app")


def test_omitted_application_name_and_empty_endpoint_use_the_defaults() -> None:
    config = _config(endpoint="")
    assert config.app_name == "dify_app"
    assert config.endpoint == "https://tracing-analysis-dc-hz.aliyuncs.com"


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://proj-xtrace-123456-cn-heyuan.cn-heyuan.log.aliyuncs.com/apm/trace/opentelemetry",
        "https://proj-xtrace-123456-cn-heyuan.cn-heyuan-intranet.log.aliyuncs.com/apm/trace/opentelemetry",
        "http://tracing-cn-heyuan.arms.aliyuncs.com",
        "http://tracing-cn-heyuan-internal.arms.aliyuncs.com",
        "http://[::1]:4318/reverse",
    ],
)
def test_documented_endpoint_formats_are_kept(endpoint: str) -> None:
    assert _config(endpoint=endpoint).endpoint == endpoint


def test_internationalized_hosts_are_ascii_encoded() -> None:
    assert _config(endpoint="https://BÜCHER.example/collector/").endpoint == "https://xn--bcher-kva.example/collector"


@pytest.mark.parametrize(
    "endpoint",
    [
        "ftp://host.test",
        "host.test",
        "https:///missing",
        "https://user:secret@host.test",
        "https://host.test?",
        "https://host.test#",
        "https://host.test/path?key=DO-NOT-PRINT",
        "https://host.test:bad",
        "https://host.test:0",
        "https://host.test:65536",
        "https://host.test:",
        "https://[invalid",
        "\nhttps://host.test",
        "https://ho\nst.test",
        "https://host.test\\@elsewhere",
        "https://host.test/a/../b",
        "https://host.test/a/%2e%2e/b",
        "https://host.test/a%2fb",
        "https://host.test/%252e%252e",
        "https://host.test/%zz",
        "https://host.test/%ff",
        "https://host.test/double//path",
        "https://host.test/api/otlp/traces",
        "https://host.test/v1/traces",
    ],
)
def test_unsafe_or_completed_routes_are_rejected_without_echo(endpoint: str) -> None:
    with pytest.raises(ValidationError) as caught:
        _config(endpoint=endpoint)
    rendered = _rendered(caught.value)
    assert "Aliyun requires an HTTP(S) base URL" in rendered
    assert "host.test" not in rendered
    assert "DO-NOT-PRINT" not in rendered


@pytest.mark.parametrize(
    "endpoint",
    [
        f"https://tracing-analysis-dc-hz.aliyuncs.com/adapt_{EMBEDDED_KEY}@abc_{EMBEDDED_KEY}@def/api/otlp/traces",
        f"https://host.test/reverse/adapt_{EMBEDDED_KEY}/api/v1/traces/",
        f"https://host.test/%61dapt_{EMBEDDED_KEY}",
    ],
)
def test_pasted_collector_urls_embedding_the_license_key_are_rejected_without_echo(endpoint: str) -> None:
    with pytest.raises(ValidationError) as caught:
        _config(license_key=EMBEDDED_KEY, endpoint=endpoint)
    assert EMBEDDED_KEY not in _rendered(caught.value)


@pytest.mark.parametrize("endpoint", [None, 1])
def test_non_string_endpoints_are_rejected(endpoint: object) -> None:
    with pytest.raises(ValidationError):
        _config(endpoint=endpoint)


@pytest.mark.parametrize("field", ["endpoint", "license_key"])
def test_required_fields_are_not_invented(field: str) -> None:
    stored = {"endpoint": ENDPOINT, "license_key": "synthetic-key"}
    del stored[field]
    with pytest.raises(ValidationError):
        AliyunConfig.model_validate(stored)


@pytest.mark.parametrize(
    "key", ["", " ", " DO-NOT-PRINT", "DO-NOT-PRINT ", "DO-NOT\nPRINT", "DO-NOT\x00PRINT", "DO-NOT\ud800PRINT"]
)
def test_unusable_license_keys_are_rejected_without_echo(key: str) -> None:
    with pytest.raises(ValidationError) as caught:
        _config(license_key=key)
    rendered = _rendered(caught.value)
    assert "Aliyun requires a nonempty license key" in rendered
    assert "DO-NOT" not in rendered


def test_masked_license_keys_pass_validation_for_verify_and_send_to_refuse() -> None:
    assert _config(license_key="***masked").license_key == "***masked"


@pytest.mark.parametrize("name", ["app\nname", "app\x00name", "app\x7fname"])
def test_application_names_with_control_characters_are_rejected(name: str) -> None:
    with pytest.raises(ValidationError, match="application name without control characters"):
        _config(app_name=name)
