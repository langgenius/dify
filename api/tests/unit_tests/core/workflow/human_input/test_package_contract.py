import importlib
from datetime import timedelta

import pytest
from pydantic import ValidationError

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


def test_human_input_package_requires_extensions_when_custom_file_type_is_allowed() -> None:
    module = _load_human_input_package()

    with pytest.raises(ValidationError, match="allowed_file_extensions"):
        module.FileInputConfig.model_validate(
            {
                "type": "file",
                "output_variable_name": "attachment",
                "allowed_file_types": ["document", "custom"],
                "allowed_file_upload_methods": ["remote_url"],
            }
        )


def test_human_input_package_rejects_disallowed_custom_file_extensions() -> None:
    module = _load_human_input_package()
    definition = module.FormDefinition.model_validate(
        {
            "form_content": "Upload one custom file",
            "inputs": [
                {
                    "type": "file",
                    "output_variable_name": "attachment",
                    "allowed_file_types": ["custom"],
                    "allowed_file_extensions": [".txt"],
                    "allowed_file_upload_methods": ["remote_url"],
                }
            ],
            "user_actions": [{"id": "submit", "title": "Submit"}],
            "rendered_content": "<p>Upload one custom file</p>",
            "expiration_time": naive_utc_now() + timedelta(hours=1),
        }
    )

    with pytest.raises(module.HumanInputSubmissionValidationError, match="attachment"):
        module.validate_human_input_submission(
            inputs=definition.inputs,
            user_actions=definition.user_actions,
            selected_action_id="submit",
            form_data={
                "attachment": {
                    "type": "custom",
                    "transfer_method": "remote_url",
                    "remote_url": "https://example.com/archive.exe",
                    "filename": "archive.exe",
                    "extension": ".exe",
                    "mime_type": "application/octet-stream",
                }
            },
        )
