import pytest
from flask import Flask
from sqlalchemy.orm import Session

from controllers.console.app import generator as generator_module
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from graphon.model_runtime.errors.invoke import InvokeError


def unwrap(func):
    """Unwrap a decorated function to test it directly."""
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


def _model_config_payload():
    return {
        "provider": "test_provider",
        "name": "test_model",
        "mode": "chat",
        "completion_params": {},
    }


def test_rule_generate_exceptions(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.RuleGenerateApi()
    method = unwrap(api.post)

    exceptions_to_test = [
        (ProviderTokenNotInitError("token error"), generator_module.ProviderNotInitializeError),
        (QuotaExceededError("quota error"), generator_module.ProviderQuotaExceededError),
        (ModelCurrentlyNotSupportError("model error"), generator_module.ProviderModelCurrentlyNotSupportError),
        (InvokeError("invoke error"), generator_module.CompletionRequestError),
    ]

    for err_to_raise, expected_exception in exceptions_to_test:

        def _raise(*_args, _err=err_to_raise, **_kwargs):
            raise _err

        monkeypatch.setattr(generator_module.LLMGenerator, "generate_rule_config", _raise)

        with app.test_request_context(
            "/console/api/rule-generate",
            method="POST",
            json={"instruction": "do it", "model_config": _model_config_payload()},
        ):
            with pytest.raises(expected_exception):
                method(api, "t1")


def test_rule_code_generate_exceptions(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.RuleCodeGenerateApi()
    method = unwrap(api.post)

    exceptions_to_test = [
        (QuotaExceededError("quota error"), generator_module.ProviderQuotaExceededError),
        (ModelCurrentlyNotSupportError("model error"), generator_module.ProviderModelCurrentlyNotSupportError),
        (InvokeError("invoke error"), generator_module.CompletionRequestError),
    ]

    for err_to_raise, expected_exception in exceptions_to_test:

        def _raise(*_args, _err=err_to_raise, **_kwargs):
            raise _err

        monkeypatch.setattr(generator_module.LLMGenerator, "generate_code", _raise)

        with app.test_request_context(
            "/console/api/rule-code-generate",
            method="POST",
            json={"instruction": "do it", "model_config": _model_config_payload()},
        ):
            with pytest.raises(expected_exception):
                method(api, "t1")


def test_structured_output_generate_exceptions(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    api = generator_module.RuleStructuredOutputGenerateApi()
    method = unwrap(api.post)

    exceptions_to_test = [
        (ProviderTokenNotInitError("token error"), generator_module.ProviderNotInitializeError),
        (QuotaExceededError("quota error"), generator_module.ProviderQuotaExceededError),
        (ModelCurrentlyNotSupportError("model error"), generator_module.ProviderModelCurrentlyNotSupportError),
        (InvokeError("invoke error"), generator_module.CompletionRequestError),
    ]

    for err_to_raise, expected_exception in exceptions_to_test:

        def _raise(*_args, _err=err_to_raise, **_kwargs):
            raise _err

        monkeypatch.setattr(generator_module.LLMGenerator, "generate_structured_output", _raise)

        with app.test_request_context(
            "/console/api/structured-output-generate",
            method="POST",
            json={"instruction": "do it", "model_config": _model_config_payload()},
        ):
            with pytest.raises(expected_exception):
                method(api, "t1")


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_instruction_generate_exceptions(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    api = generator_module.InstructionGenerateApi()
    method = unwrap(api.post)

    exceptions_to_test = [
        (ProviderTokenNotInitError("token error"), generator_module.ProviderNotInitializeError),
        (QuotaExceededError("quota error"), generator_module.ProviderQuotaExceededError),
        (ModelCurrentlyNotSupportError("model error"), generator_module.ProviderModelCurrentlyNotSupportError),
        (InvokeError("invoke error"), generator_module.CompletionRequestError),
    ]

    for err_to_raise, expected_exception in exceptions_to_test:

        def _raise(*_args, _err=err_to_raise, **_kwargs):
            raise _err

        monkeypatch.setattr(generator_module.LLMGenerator, "instruction_modify_legacy", _raise)

        with app.test_request_context(
            "/console/api/instruction-generate",
            method="POST",
            json={
                "flow_id": "app-1",
                "node_id": "",
                "current": "old",
                "instruction": "do it",
                "model_config": _model_config_payload(),
            },
        ):
            with pytest.raises(expected_exception):
                method(api, sqlite_session, "t1")
