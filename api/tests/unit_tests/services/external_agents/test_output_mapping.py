import base64
from collections.abc import Sequence

import pytest

from services.external_agents.io_contracts import (
    ExternalIOError,
    FileScope,
    JsonObject,
    JsonValue,
    OutputField,
    OutputMappingResult,
    StoredFile,
)
from services.external_agents.output_mapping import (
    map_output,
    normalize_node_defaults,
    safe_receipt_metadata,
    validate_output_fields,
)
from services.external_agents.protocol import TRACEABILITY_URI, GatewayReceipt

SCOPE = FileScope(tenant_id="tenant", app_id="app", actor_id="actor", invocation_id="inv")


def receipt(
    parts: Sequence[JsonObject], *, task_id: str | None = None, context_id: str | None = None, state: str | None = None
) -> GatewayReceipt:
    wire_parts: list[JsonValue] = list(parts)
    return GatewayReceipt(
        kind="message",
        payload={"messageId": "m", "contextId": "ctx", "role": "ROLE_AGENT", "parts": wire_parts},
        task_id=task_id,
        context_id=context_id,
        state=state,
    )


def map_parts(parts: list[JsonObject], fields: Sequence[OutputField]) -> OutputMappingResult:
    return map_output(receipt(parts), fields, scope=SCOPE, materializer=None)


class DurableImporter:
    def __init__(self) -> None:
        self.calls: list[tuple[str, int]] = []

    def materialize(
        self, scope: FileScope, part: JsonObject, *, artifact_id: str, part_index: int, max_bytes: int | None = None
    ) -> StoredFile:
        assert scope == SCOPE
        raw, media_type = part["raw"], part["mediaType"]
        assert isinstance(raw, str)
        assert isinstance(media_type, str)
        data = base64.b64decode(raw)
        assert max_bytes is not None
        assert len(data) <= max_bytes
        self.calls.append((artifact_id, part_index))
        return StoredFile(
            file_id="owned-file", value={"upload_file_id": "owned-file"}, size=len(data), media_type=media_type
        )


def test_structured_fields_preserve_zero_false_empty_and_project_extras() -> None:
    fields = [
        OutputField(name="n", kind="number"),
        OutputField(name="ok", kind="boolean"),
        OutputField(name="text", kind="string"),
        OutputField(name="extra", kind="string", required=False),
    ]
    result = map_parts(
        [{"data": {"n": 0, "ok": False, "text": "", "unmapped": "ignored"}}, {"text": "explanation"}], fields
    )
    assert result.values == {"n": 0, "ok": False, "text": ""}


@pytest.mark.parametrize(
    "parts", [[{"data": {"n": 1}}, {"data": {"n": 2}}], [{"text": '{"n":1,"n":2}', "mediaType": "application/json"}]]
)
def test_ambiguity_cannot_be_hidden_by_default(parts: list[JsonObject]) -> None:
    with pytest.raises(ExternalIOError) as error:
        map_parts(parts, [OutputField(name="n", kind="number", has_default=True, default=0)])
    assert error.value.code == "ambiguous_output"


def test_exponent_overflow_is_rejected_before_default_mapping() -> None:
    with pytest.raises(ExternalIOError) as error:
        map_parts(
            [{"text": '{"n":1e999}', "mediaType": "application/json"}],
            [OutputField(name="n", kind="number", has_default=True, default=0)],
        )
    assert error.value.code == "invalid_output_number"


def test_output_variable_byte_limit_uses_utf8_and_only_a_valid_bounded_default() -> None:
    output = receipt([{"data": {"text": "汉" * 5}}])
    with pytest.raises(ExternalIOError) as error:
        map_output(
            output, [OutputField(name="text", kind="string")], scope=SCOPE, materializer=None, max_variable_bytes=12
        )
    assert error.value.code == "output_variable_too_large"
    result = map_output(
        output,
        [OutputField(name="text", kind="string", has_default=True, default="ok")],
        scope=SCOPE,
        materializer=None,
        max_variable_bytes=12,
    )
    assert result.values == {"text": "ok"}
    assert result.defaults_applied == ("text",)


def test_node_defaults_project_objects_apply_child_defaults_and_reject_files_and_unknown_keys() -> None:
    fields = [
        OutputField(
            name="record",
            kind="object",
            children=(OutputField(name="valid", kind="boolean", has_default=True, default=False),),
        ),
        OutputField(name="report", kind="file"),
    ]
    assert normalize_node_defaults({"record": {"extra": "removed"}}, fields) == {"record": {"valid": False}}
    for defaults in ({"unknown": 1}, {"report": "file-id"}):
        with pytest.raises(ExternalIOError):
            normalize_node_defaults(defaults, fields)


def test_plain_json_looking_prose_is_not_heuristically_decoded() -> None:
    result = map_parts([{"text": '{"n": 4}'}], [OutputField(name="text", kind="string")])
    assert result.values == {"text": '{"n": 4}'}


def test_required_type_failure_uses_only_valid_field_default() -> None:
    result = map_parts([{"data": {"n": False}}], [OutputField(name="n", kind="number", has_default=True, default=0)])
    assert result.values == {"n": 0}
    assert result.defaults_applied == ("n",)


def test_recursive_array_and_object_children_validate_strictly() -> None:
    fields = [
        OutputField(
            name="items",
            kind="array",
            item=OutputField(name="item", kind="object", children=(OutputField(name="valid", kind="boolean"),)),
        )
    ]
    assert map_parts([{"data": {"items": []}}], fields).values == {"items": []}
    with pytest.raises(ExternalIOError):
        map_parts([{"data": {"items": [{"valid": "true"}]}}], fields)


@pytest.mark.parametrize(
    "field",
    [
        OutputField(name="f", kind="file", has_default=True, default="id"),
        OutputField(name="a", kind="array", item=OutputField(name="f", kind="file"), has_default=True, default=[]),
        OutputField(
            name="o", kind="object", children=(OutputField(name="f", kind="file"),), has_default=True, default={}
        ),
    ],
)
def test_no_file_default_bypass(field: OutputField) -> None:
    with pytest.raises(ExternalIOError) as error:
        validate_output_fields([field])
    assert error.value.code == "file_default_forbidden"


def test_url_string_is_not_classified_as_a_file() -> None:
    result = map_parts(
        [{"data": {"download_url": "https://example.test/file_id"}}],
        [OutputField(name="download_url", kind="string", has_default=True, default="")],
    )
    assert result.values["download_url"] == "https://example.test/file_id"


def test_file_artifact_name_and_one_target_are_unambiguous() -> None:
    importer = DurableImporter()
    part: JsonObject = {
        "raw": base64.b64encode(b"file").decode(),
        "mediaType": "application/pdf",
        "filename": "not-output-name.pdf",
    }
    result = map_output(receipt([part]), [OutputField(name="report", kind="file")], scope=SCOPE, materializer=importer)
    assert result.values == {"report": {"upload_file_id": "owned-file"}}
    assert importer.calls == [("message", 0)]
    with pytest.raises(ExternalIOError):
        map_output(
            receipt([part]),
            [OutputField(name="a", kind="file"), OutputField(name="b", kind="file")],
            scope=SCOPE,
            materializer=importer,
        )
    with pytest.raises(ExternalIOError):
        map_output(receipt([part, part]), [OutputField(name="report", kind="file")], scope=SCOPE, materializer=importer)


def test_history_status_and_trace_only_artifact_are_not_business_output() -> None:
    payload: JsonObject = {
        "id": "t",
        "status": {"state": "TASK_STATE_COMPLETED", "message": {"parts": [{"text": "status"}]}},
        "history": [{"parts": [{"text": "history"}]}],
        "artifacts": [
            {
                "artifactId": "trace",
                "extensions": [TRACEABILITY_URI],
                "parts": [{"data": {"trace_id": "x", "steps": []}}],
            },
            {"artifactId": "business", "parts": [{"text": "final"}]},
        ],
    }
    result = map_output(
        GatewayReceipt(kind="task", task_id="t", state="TASK_STATE_COMPLETED", payload=payload),
        [OutputField(name="text", kind="string")],
        scope=SCOPE,
        materializer=None,
    )
    assert result.values == {"text": "final"}


def test_safe_history_cannot_resurrect_raw_or_secret_file_url() -> None:
    metadata = safe_receipt_metadata(receipt([{"raw": "secret-base64"}, {"url": "https://secret.example?token=x"}]))
    assert set(metadata) == {"kind", "task_id", "context_id", "state"}
    assert "secret" not in str(metadata)
