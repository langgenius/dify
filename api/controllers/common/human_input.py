import json

from flask import Response, request
from pydantic import BaseModel, Field, JsonValue

from factories.human_input_v2_form_presentation import build_form_presentation
from libs.helper import extract_remote_ip, to_timestamp
from repositories.human_input_v2.form_repository import Form as V2Form

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
    """Legacy Human Input v1 submit payload shared by existing runtime surfaces."""

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


def viewer_ip_address() -> str | None:
    """The request's remote address for a form-view audit; None when it has none."""
    return extract_remote_ip(request) or None


def v2_form_definition_response(form: V2Form, model: type[BaseModel]) -> Response:
    """A v2 form in a v1 form-definition `model`, for the describe ops that predate v2."""
    presentation = build_form_presentation(form.resolved_form)
    definition = model.model_validate(
        {
            "form_content": presentation.form_content,
            "inputs": [field.model_dump(mode="json") for field in presentation.inputs],
            "resolved_default_values": presentation.resolved_default_values,
            "user_actions": [action.model_dump(mode="json") for action in presentation.user_actions],
            "expiration_time": to_timestamp(min(form.expiration_time, form.global_timeout_deadline)),
        }
    )
    return Response(definition.model_dump_json(), mimetype="application/json")
