"""Human input transport delegates parsed payloads to application services."""

from unittest.mock import Mock, create_autospec

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.console.app import workflow as controller
from extensions.ext_application_services import ApplicationServices
from services.human_input.debug_service import HumanInputDebugService
from tests.unit_tests.controllers.console.app.test_workflow import (
    APP_ID,
    CONTEXT,
    invoke,
)


@pytest.fixture(name="workflows")
def debug_use_cases(monkeypatch: pytest.MonkeyPatch) -> Mock:
    service = create_autospec(HumanInputDebugService, instance=True)
    dependencies = create_autospec(ApplicationServices, instance=True)
    dependencies.human_input_debug = service
    monkeypatch.setattr(controller, "application_services", lambda: dependencies)
    return service


@pytest.mark.parametrize(
    "resource", [controller.AdvancedChatDraftHumanInputFormPreviewApi, controller.WorkflowDraftHumanInputFormPreviewApi]
)
def test_preview_forwards_inputs(
    app: Flask,
    workflows: Mock,
    resource: type[
        controller.AdvancedChatDraftHumanInputFormPreviewApi | controller.WorkflowDraftHumanInputFormPreviewApi
    ],
) -> None:
    payload = {
        "form_id": "human",
        "node_id": "human",
        "node_title": "Human input",
        "form_content": "Hello",
        "inputs": [{"type": "paragraph", "output_variable_name": "topic", "default": None}],
        "actions": [{"id": "continue", "title": "Continue", "button_style": "default"}],
        "resolved_default_values": {"topic": ""},
    }
    workflows.preview_form.return_value = payload
    args = controller.HumanInputFormPreviewPayload(inputs={"topic": "tech"})
    with app.test_request_context(method="POST"):
        assert invoke(resource, resource.post, args, node_id="human") == {
            **payload,
            "display_in_ui": None,
            "form_token": None,
            "expiration_time": None,
        }
    workflows.preview_form.assert_called_once_with(CONTEXT, str(APP_ID), "human", {"topic": "tech"})


@pytest.mark.parametrize(
    "resource", [controller.AdvancedChatDraftHumanInputFormRunApi, controller.WorkflowDraftHumanInputFormRunApi]
)
def test_submission_forwards_form_and_upstream_inputs(
    app: Flask,
    workflows: Mock,
    resource: type[controller.AdvancedChatDraftHumanInputFormRunApi | controller.WorkflowDraftHumanInputFormRunApi],
) -> None:
    outputs = {"answer": "42", "__action_id": "approve"}
    workflows.submit_form.return_value = outputs
    args = controller.HumanInputFormPreviewSubmitPayload(
        form_inputs={"answer": "42"}, inputs={"#upstream.output#": "text"}, action="approve"
    )
    with app.test_request_context(method="POST"):
        assert invoke(resource, resource.post, args, node_id="human") == outputs
    workflows.submit_form.assert_called_once_with(
        CONTEXT,
        str(APP_ID),
        "human",
        form_inputs={"answer": "42"},
        inputs={"#upstream.output#": "text"},
        action="approve",
    )


def test_delivery_forwards_default_inputs(app: Flask, workflows: Mock) -> None:
    args = controller.HumanInputDeliveryTestPayload(delivery_method_id="email")
    with app.test_request_context(method="POST"):
        assert (
            invoke(
                controller.WorkflowDraftHumanInputDeliveryTestApi,
                controller.WorkflowDraftHumanInputDeliveryTestApi.post,
                args,
                node_id="human",
            )
            == {}
        )
    workflows.test_delivery.assert_called_once_with(
        CONTEXT, str(APP_ID), "human", inputs={}, delivery_method_id="email"
    )


def test_delivery_preserves_domain_error(app: Flask, workflows: Mock) -> None:
    workflows.test_delivery.side_effect = ValueError("bad delivery method")
    args = controller.HumanInputDeliveryTestPayload(delivery_method_id="bad")
    with app.test_request_context(method="POST"), pytest.raises(ValueError, match="bad delivery method"):
        invoke(
            controller.WorkflowDraftHumanInputDeliveryTestApi,
            controller.WorkflowDraftHumanInputDeliveryTestApi.post,
            args,
            node_id="human",
        )


def test_preview_rejects_non_mapping_inputs() -> None:
    with pytest.raises(ValidationError):
        controller.HumanInputFormPreviewPayload.model_validate({"inputs": ["not-a-dict"]})
