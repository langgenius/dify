from __future__ import annotations

import pytest
from pydantic import ValidationError

from dify_agent.layers.browser import DifyBrowserLayerConfig
from dify_agent.layers.browser.layer import State


def test_config_defaults() -> None:
    config = DifyBrowserLayerConfig()

    assert config.runtime == "runtime"
    assert config.max_steps == 30
    assert config.use_vision == "auto"
    assert config.headless is True
    assert config.allowed_domains is None
    assert config.block_ip_addresses is True
    assert config.session_scope == "call"
    assert config.use_judge is False
    assert config.step_timeout_seconds == 180
    assert config.output_schema is None
    assert config.sensitive_data is None
    assert config.persist_login_state is False


def test_config_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        DifyBrowserLayerConfig(**{"bogus": 1})


def test_config_validates_budgets_and_scope() -> None:
    with pytest.raises(ValidationError):
        DifyBrowserLayerConfig(max_steps=0)
    with pytest.raises(ValidationError):
        DifyBrowserLayerConfig(step_timeout_seconds=0)
    with pytest.raises(ValidationError):
        DifyBrowserLayerConfig(session_scope="shared")
    with pytest.raises(ValidationError):
        DifyBrowserLayerConfig(use_vision="never")
    with pytest.raises(ValidationError):
        DifyBrowserLayerConfig(allowed_domains=[])


def test_config_accepts_valid_output_schema() -> None:
    schema = {
        "type": "object",
        "properties": {"title": {"type": "string"}, "price": {"type": "number"}},
        "required": ["title"],
    }
    config = DifyBrowserLayerConfig(output_schema=schema)
    assert config.output_schema == schema


def test_config_rejects_unsupported_output_schema() -> None:
    with pytest.raises(ValidationError, match="not supported"):
        DifyBrowserLayerConfig(output_schema={"type": "object", "properties": {"a": {"$ref": "#"}}})
    with pytest.raises(ValidationError, match="JSON object with 'properties'"):
        DifyBrowserLayerConfig(output_schema={"type": "string"})


def test_config_flat_sensitive_data_requires_explicit_allowlist() -> None:
    with pytest.raises(ValidationError, match="explicit hostnames"):
        DifyBrowserLayerConfig(sensitive_data={"x_password": "secret"})
    with pytest.raises(ValidationError, match="explicit hostnames"):
        DifyBrowserLayerConfig(sensitive_data={"x_password": "secret"}, allowed_domains=["*.example.com"])
    config = DifyBrowserLayerConfig(
        sensitive_data={"x_password": "secret"}, allowed_domains=["https://shop.example.com"]
    )
    assert config.sensitive_data == {"x_password": "secret"}


def test_config_nested_sensitive_data_needs_no_allowlist() -> None:
    config = DifyBrowserLayerConfig(sensitive_data={"https://shop.example.com": {"x_password": "s"}})
    assert config.sensitive_data == {"https://shop.example.com": {"x_password": "s"}}


def test_config_persist_login_state_round_trips() -> None:
    config = DifyBrowserLayerConfig(persist_login_state=True)
    dumped = config.model_dump(mode="json")
    assert DifyBrowserLayerConfig.model_validate(dumped).persist_login_state is True


def test_state_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        State(**{"job_id": "job-1"})


def test_state_round_trips_empty_json() -> None:
    assert State().model_dump(mode="json") == {}
    assert State.model_validate({}) == State()
