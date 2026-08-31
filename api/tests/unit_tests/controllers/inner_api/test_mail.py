"""Unit tests for the thin inner-mail Flask adapter and its admission boundary."""

from collections.abc import Callable
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from pydantic import ValidationError
from werkzeug.exceptions import NotFound

from controllers.inner_api.mail import BaseMail, BillingMail, EnterpriseMail, InnerMailPayload
from controllers.inner_api.wraps import InnerApiUnauthorizedError
from services.entities.mail_entities import InnerMailMessage


class TestInnerMailPayload:
    def test_valid_payload_with_all_fields(self) -> None:
        payload = InnerMailPayload.model_validate(
            {
                "to": ["test@example.com"],
                "subject": "Test Subject",
                "body": "Test Body",
                "substitutions": {"key": "value"},
            }
        )
        assert payload.to == ["test@example.com"]
        assert payload.substitutions == {"key": "value"}

    def test_valid_payload_without_substitutions(self) -> None:
        payload = InnerMailPayload.model_validate(
            {"to": ["test@example.com"], "subject": "Test Subject", "body": "Test Body"}
        )
        assert payload.substitutions is None

    def test_valid_payload_with_null_substitutions(self) -> None:
        payload = InnerMailPayload.model_validate(
            {
                "to": ["test@example.com"],
                "subject": "Test Subject",
                "body": "Test Body",
                "substitutions": None,
            }
        )
        assert payload.substitutions is None

    @pytest.mark.parametrize(
        "payload",
        [
            {"to": [], "subject": "Subject", "body": "Body"},
            {"subject": "Subject", "body": "Body"},
            {"to": ["test@example.com"], "body": "Body"},
            {"to": ["test@example.com"], "subject": "Subject"},
        ],
    )
    def test_invalid_payload(self, payload: dict[str, object]) -> None:
        with pytest.raises(ValidationError):
            InnerMailPayload.model_validate(payload)


class TestBaseMail:
    @pytest.mark.parametrize(
        ("resource_type", "payload", "expected"),
        [
            (
                EnterpriseMail,
                {"to": ["test@example.com"], "subject": "Subject", "body": "Body"},
                InnerMailMessage(recipients=("test@example.com",), subject="Subject", body="Body", substitutions=None),
            ),
            (
                BillingMail,
                {
                    "to": ["one@example.com", "two@example.com"],
                    "subject": "Hello {{name}}",
                    "body": "Welcome {{name}}!",
                    "substitutions": {"name": "John"},
                },
                InnerMailMessage(
                    recipients=("one@example.com", "two@example.com"),
                    subject="Hello {{name}}",
                    body="Welcome {{name}}!",
                    substitutions={"name": "John"},
                ),
            ),
        ],
    )
    def test_post_delegates_to_application_service(
        self,
        resource_type: type[BaseMail],
        payload: dict[str, object],
        expected: InnerMailMessage,
        app: Flask,
    ) -> None:
        mail_service = MagicMock()
        services = SimpleNamespace(inner_mail=mail_service)

        with (
            app.test_request_context(),
            patch("controllers.inner_api.mail.inner_api_ns") as namespace,
            patch("controllers.inner_api.mail.application_services", return_value=services),
        ):
            namespace.payload = payload
            result = unwrap(resource_type.post)(resource_type())

        assert result == ({"message": "success"}, 200)
        mail_service.send.assert_called_once_with(expected)


def test_disabled_inner_api_returns_not_found_before_setup(app: Flask, config_overrides: Callable[..., None]) -> None:
    config_overrides(INNER_API=False)
    with patch(
        "controllers.console.wraps._is_setup_completed",
        side_effect=AssertionError("setup must not run before Inner API authentication"),
    ):
        with app.test_request_context(), pytest.raises(NotFound):
            EnterpriseMail().post()


def test_invalid_inner_api_key_is_rejected_before_setup(app: Flask, config_overrides: Callable[..., None]) -> None:
    config_overrides(INNER_API=True, INNER_API_KEY="valid-key")
    with patch(
        "controllers.console.wraps._is_setup_completed",
        side_effect=AssertionError("setup must not run before Inner API authentication"),
    ):
        with (
            app.test_request_context(headers={"X-Inner-Api-Key": "invalid-key"}),
            pytest.raises(InnerApiUnauthorizedError),
        ):
            EnterpriseMail().post()
