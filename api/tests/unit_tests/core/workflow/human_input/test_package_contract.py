import importlib
from datetime import timedelta

import pytest

from libs.datetime_utils import naive_utc_now


def _load_human_input_package():
    try:
        return importlib.import_module("core.workflow.human_input")
    except ModuleNotFoundError as exc:
        pytest.fail(
            "expected Dify-owned human input package at 'core.workflow.human_input': "
            f"{exc}"
        )


def test_human_input_package_exports_dify_owned_form_contract() -> None:
    module = _load_human_input_package()

    expected_exports = {
        "FileInputConfig",
        "FileListInputConfig",
        "FormDefinition",
        "HumanInputSubmissionValidationError",
        "SelectInputConfig",
        "StringListSource",
        "UserActionConfig",
        "ValueSourceType",
        "validate_human_input_submission",
    }

    missing_exports = sorted(name for name in expected_exports if not hasattr(module, name))

    assert missing_exports == []


def test_human_input_package_validates_select_and_file_payloads() -> None:
    module = _load_human_input_package()
    definition = module.FormDefinition.model_validate(
        {
            "form_content": "Pick one and upload files",
            "inputs": [
                {
                    "type": "select",
                    "output_variable_name": "decision",
                    "option_source": {
                        "type": "constant",
                        "value": ["approve", "reject"],
                    },
                },
                {
                    "type": "file",
                    "output_variable_name": "attachment",
                    "allowed_file_types": ["document"],
                    "allowed_file_upload_methods": ["remote_url"],
                },
                {
                    "type": "file-list",
                    "output_variable_name": "attachments",
                    "allowed_file_types": ["document"],
                    "allowed_file_upload_methods": ["remote_url"],
                    "number_limits": 2,
                },
            ],
            "user_actions": [{"id": "submit", "title": "Submit"}],
            "rendered_content": "<p>Pick one and upload files</p>",
            "expiration_time": naive_utc_now() + timedelta(hours=1),
        }
    )

    module.validate_human_input_submission(
        inputs=definition.inputs,
        user_actions=definition.user_actions,
        selected_action_id="submit",
        form_data={
            "decision": "approve",
            "attachment": {
                "type": "document",
                "transfer_method": "remote_url",
                "remote_url": "https://example.com/resume.pdf",
                "filename": "resume.pdf",
                "extension": ".pdf",
                "mime_type": "application/pdf",
            },
            "attachments": [
                {
                    "type": "document",
                    "transfer_method": "remote_url",
                    "remote_url": "https://example.com/a.pdf",
                    "filename": "a.pdf",
                    "extension": ".pdf",
                    "mime_type": "application/pdf",
                },
                {
                    "type": "document",
                    "transfer_method": "remote_url",
                    "remote_url": "https://example.com/b.pdf",
                    "filename": "b.pdf",
                    "extension": ".pdf",
                    "mime_type": "application/pdf",
                },
            ],
        },
    )


@pytest.mark.parametrize(
    ("input_definition", "submitted_value", "expected_message"),
    [
        (
            {
                "type": "select",
                "output_variable_name": "decision",
                "option_source": {
                    "type": "constant",
                    "value": ["approve", "reject"],
                },
            },
            "hold",
            "decision",
        ),
        (
            {
                "type": "file",
                "output_variable_name": "attachment",
                "allowed_file_types": ["document"],
                "allowed_file_upload_methods": ["remote_url"],
            },
            "not-a-file",
            "attachment",
        ),
        (
            {
                "type": "file-list",
                "output_variable_name": "attachments",
                "allowed_file_types": ["document"],
                "allowed_file_upload_methods": ["remote_url"],
                "number_limits": 2,
            },
            [
                {
                    "type": "document",
                    "transfer_method": "remote_url",
                    "remote_url": "https://example.com/a.pdf",
                    "filename": "a.pdf",
                    "extension": ".pdf",
                    "mime_type": "application/pdf",
                },
                "not-a-file",
            ],
            "attachments",
        ),
    ],
)
def test_human_input_package_rejects_invalid_payload_shapes(
    input_definition: dict,
    submitted_value: object,
    expected_message: str,
) -> None:
    module = _load_human_input_package()
    definition = module.FormDefinition.model_validate(
        {
            "form_content": "Validate form data",
            "inputs": [input_definition],
            "user_actions": [{"id": "submit", "title": "Submit"}],
            "rendered_content": "<p>Validate form data</p>",
            "expiration_time": naive_utc_now() + timedelta(hours=1),
        }
    )

    with pytest.raises(module.HumanInputSubmissionValidationError, match=expected_message):
        module.validate_human_input_submission(
            inputs=definition.inputs,
            user_actions=definition.user_actions,
            selected_action_id="submit",
            form_data={input_definition["output_variable_name"]: submitted_value},
        )

