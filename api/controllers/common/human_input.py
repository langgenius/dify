import json

from pydantic import BaseModel, Field, JsonValue

HUMAN_INPUT_FORM_INPUT_EXAMPLE = {
    "decision": "approve",
    "attachment": {
        "transfer_method": "local_file",
        "upload_file_id": "4e0d1b87-52f2-49f6-b8c6-95cd9c954b3e",
        "type": "document",
    },
    "attachments": [
        {
            "transfer_method": "local_file",
            "upload_file_id": "1a77f0df-c0e6-461c-987c-e72526f341ee",
            "type": "document",
        },
        {
            "transfer_method": "remote_url",
            "url": "https://example.com/report.pdf",
            "type": "document",
        },
    ],
}


class HumanInputFormSubmitPayload(BaseModel):
    """Shared runtime submit payload across console, web, service API, and OpenAPI."""

    inputs: dict[str, JsonValue] = Field(
        description=(
            "Submitted human input values keyed by output variable name. "
            "Use a string for paragraph or select input values, a file mapping for file inputs, "
            "and a list of file mappings for file-list inputs. Local file mappings use "
            "`transfer_method=local_file` with `upload_file_id`; remote file mappings use "
            "`transfer_method=remote_url` with `url` or `remote_url`."
        ),
        examples=[HUMAN_INPUT_FORM_INPUT_EXAMPLE],
    )
    action: str = Field(
        description=(
            "ID of the action button the recipient selected. Must match one of the `id` values from the form's "
            "`user_actions` list."
        )
    )
    challenge_token: str | None = Field(
        default=None,
        description=(
            "Optional OTP challenge token used only by the public web submit flow. "
            "Obtain it from the web access-request endpoint, and omit it on console, service API, and OpenAPI "
            "submissions."
        ),
    )
    otp_code: str | None = Field(
        default=None,
        description=(
            "Optional OTP code used only by the public web submit flow. "
            "Provide it together with `challenge_token` when the public web form requires OTP verification, "
            "and omit it on other surfaces."
        ),
    )


def stringify_form_default_values(values: dict[str, object]) -> dict[str, str]:
    """Serialize default values into strings expected by human-input form clients."""
    result: dict[str, str] = {}
    for key, value in values.items():
        match value:
            case None:
                result[key] = ""
            case dict() | list():
                result[key] = json.dumps(value, ensure_ascii=False)
            case _:
                result[key] = str(value)
    return result
