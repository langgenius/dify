"""Strict output selection and atomic publication with real owned file storage."""

import base64
from collections.abc import Sequence

import pytest
from sqlalchemy import select

from models.model import UploadFile
from services.external_agents.file_profile import FileLimits
from services.external_agents.io_contracts import ExternalIOError, FileReference, JsonObject, JsonValue, OutputField
from services.external_agents.output_mapping import map_output, validate_output_fields
from services.external_agents.protocol import GatewayReceipt
from tests.unit_tests.providers.a2a import test_files as file_fixtures
from tests.unit_tests.providers.a2a.test_files import FileDomain
from tests.unit_tests.services.external_agents.test_output_mapping import SCOPE, receipt

file_domain = file_fixtures.file_domain


def completed(artifacts: list[JsonValue], *, state: str = "TASK_STATE_COMPLETED") -> GatewayReceipt:
    return GatewayReceipt(
        kind="task",
        task_id="task",
        state=state,
        payload={"id": "task", "status": {"state": state}, "artifacts": artifacts},
    )


def mapped(parts: Sequence[JsonObject], fields: Sequence[OutputField]) -> JsonObject:
    return map_output(receipt(parts), fields, scope=SCOPE, materializer=None).values


@pytest.mark.parametrize(
    "fields",
    [
        (OutputField(name="", kind="string"),),
        (OutputField(name="same", kind="string"), OutputField(name="same", kind="number")),
        (OutputField(name="values", kind="array"),),
    ],
)
def test_invalid_declarations_fail_before_consuming_remote_output(fields: tuple[OutputField, ...]) -> None:
    with pytest.raises(ExternalIOError) as failure:
        validate_output_fields(fields)
    assert failure.value.code == "invalid_output_schema"


@pytest.mark.parametrize(
    ("text", "code"),
    [
        ('{"count":NaN}', "invalid_output_number"),
        ('{"count":Infinity}', "invalid_output_number"),
        ('{"count":', "invalid_structured_output"),
        ("[1,2]", "invalid_structured_output"),
    ],
)
def test_explicit_json_errors_are_not_hidden_by_field_defaults(text: str, code: str) -> None:
    with pytest.raises(ExternalIOError) as failure:
        mapped(
            [{"text": text, "mediaType": "application/json"}],
            [OutputField(name="count", kind="number", has_default=True, default=0)],
        )
    assert failure.value.code == code


def test_explicit_json_preserves_finite_numbers_and_unconstrained_objects() -> None:
    fields = [
        OutputField(name="count", kind="integer"),
        OutputField(name="ratio", kind="number"),
        OutputField(name="record", kind="object"),
    ]
    assert mapped(
        [
            {
                "text": '{"count":0,"ratio":1.25,"record":{"enabled":false,"items":[]}}',
                "mediaType": " Application/JSON; charset=utf-8 ",
            }
        ],
        fields,
    ) == {"count": 0, "ratio": 1.25, "record": {"enabled": False, "items": []}}
    with pytest.raises(ExternalIOError) as failure:
        mapped([{"data": {"count": True, "ratio": 0, "record": {}}}], fields)
    assert failure.value.code == "output_validation_failed"


@pytest.mark.parametrize("state", ["TASK_STATE_WORKING", "TASK_STATE_FAILED", "TASK_STATE_CANCELED"])
def test_noncompleted_tasks_never_publish_their_partial_artifacts(state: str) -> None:
    remote = completed([{"artifactId": "progress", "parts": [{"text": "partial"}]}], state=state)
    with pytest.raises(ExternalIOError) as failure:
        map_output(remote, [OutputField(name="text", kind="string")], scope=SCOPE, materializer=None)
    assert failure.value.code == "task_not_completed"


def test_duplicate_completed_artifact_identity_is_ambiguous_even_with_distinct_text() -> None:
    remote = completed(
        [{"artifactId": "same", "parts": [{"text": "first"}]}, {"artifactId": "same", "parts": [{"text": "second"}]}]
    )
    with pytest.raises(ExternalIOError) as failure:
        map_output(
            remote,
            [OutputField(name="text", kind="string", has_default=True, default="fallback")],
            scope=SCOPE,
            materializer=None,
        )
    assert failure.value.code == "ambiguous_output"


def test_empty_text_is_valid_and_multiple_artifacts_follow_wire_order() -> None:
    remote = completed(
        [
            {"artifactId": "first", "parts": [{"text": ""}]},
            {"artifactId": "second", "parts": [{"text": "second"}, {"text": "!"}]},
        ]
    )
    assert map_output(remote, [OutputField(name="text", kind="string")], scope=SCOPE, materializer=None).values == {
        "text": "second!"
    }
    assert mapped([{"text": ""}], [OutputField(name="text", kind="string")]) == {"text": ""}


@pytest.mark.parametrize(
    ("kind", "payload"),
    [
        ("message", {"parts": "corrupted"}),
        ("message", {"parts": ["corrupted"]}),
        ("message", {"parts": [{"text": 42}]}),
        ("task", {"artifacts": "corrupted"}),
        ("task", {"artifacts": ["corrupted"]}),
        ("task", {"artifacts": [{"artifactId": "a", "parts": "corrupted"}]}),
    ],
)
def test_invalid_plain_receipts_fail_closed_before_output_publication(kind: str, payload: JsonObject) -> None:
    """Rehydrating a malformed response cannot create guessed downstream values."""
    remote = GatewayReceipt(
        kind="message" if kind == "message" else "task", state="TASK_STATE_COMPLETED", payload=payload
    )
    with pytest.raises(ExternalIOError) as failure:
        map_output(
            remote,
            [OutputField(name="text", kind="string", has_default=True, default="fallback")],
            scope=SCOPE,
            materializer=None,
        )
    assert failure.value.code == "invalid_response"


@pytest.mark.parametrize("data", [None, [1, 2], "record"])
def test_data_part_requires_exact_top_level_field_names(data: JsonValue) -> None:
    with pytest.raises(ExternalIOError) as failure:
        mapped([{"data": data}], [OutputField(name="text", kind="string", has_default=True, default="fallback")])
    assert failure.value.code == "invalid_structured_output"


def raw_part(data: bytes, filename: str = "source.txt") -> JsonObject:
    return {"raw": base64.b64encode(data).decode(), "mediaType": "text/plain", "filename": filename}


@pytest.mark.parametrize(
    "problem", ["too_many", "structured_competitor", "missing_materializer", "wrong_artifact_name"]
)
def test_file_mapping_failure_cannot_guess_a_target_or_publish_a_partial_result(problem: str) -> None:
    part = raw_part(b"content", "report")
    parts: list[JsonValue] = [part, part] if problem == "too_many" else [part]
    if problem == "structured_competitor":
        parts.insert(0, {"data": {"report": "untrusted remote file ID"}})
    remote = completed(
        [{"artifactId": "a", "name": "wrong" if problem == "wrong_artifact_name" else "report", "parts": parts}]
    )
    with pytest.raises(ExternalIOError) as failure:
        map_output(
            remote,
            [OutputField(name="report", kind="file")],
            scope=SCOPE,
            materializer=None,
            limits=FileLimits(max_files=1),
        )
    assert (
        failure.value.code
        == {
            "too_many": "too_many_files",
            "structured_competitor": "ambiguous_output",
            "missing_materializer": "file_materializer_unavailable",
            "wrong_artifact_name": "ambiguous_output",
        }[problem]
    )


def test_array_file_output_materializes_in_artifact_order_at_exact_total_budget(file_domain: FileDomain) -> None:
    adapter, _, _, sessions, _ = file_domain
    owner = file_fixtures.scope()
    remote = completed(
        [
            {"artifactId": "a", "name": "reports", "parts": [raw_part(b"one", "first.txt")]},
            {"artifactId": "b", "name": "reports", "parts": [raw_part(b"two", "second.txt")]},
        ]
    )
    fields = [OutputField(name="reports", kind="array", item=OutputField(name="item", kind="file"))]
    result = map_output(remote, fields, scope=owner, materializer=adapter, limits=FileLimits(max_total_bytes=6))
    outputs = result.values["reports"]
    assert isinstance(outputs, list)
    assert len(outputs) == 2
    for value, expected, filename in zip(outputs, (b"one", b"two"), ("first.txt", "second.txt"), strict=True):
        assert isinstance(value, dict)
        file_id = value["upload_file_id"]
        assert isinstance(file_id, str)
        assert value["filename"] == filename
        assert adapter.read_authorized(owner, FileReference(file_id=file_id), max_bytes=3).data == expected
    with sessions() as session:
        assert len(session.scalars(select(UploadFile)).all()) == 2


def test_second_file_over_budget_leaves_only_owned_storage_for_cleanup(file_domain: FileDomain) -> None:
    adapter, _, lifecycle, sessions, _ = file_domain
    owner = file_fixtures.scope()
    remote = completed([{"artifactId": "a", "name": "reports", "parts": [raw_part(b"one"), raw_part(b"four")]}])
    with pytest.raises(ExternalIOError) as failure:
        map_output(
            remote,
            [OutputField(name="reports", kind="array", item=OutputField(name="item", kind="file"))],
            scope=owner,
            materializer=adapter,
            limits=FileLimits(max_total_bytes=6),
        )
    assert failure.value.code == "file_too_large"
    assert len(lifecycle.files) == 1
    with sessions() as session:
        assert len(session.scalars(select(UploadFile)).all()) == 1


def test_a_default_must_fit_the_same_variable_budget_as_the_failed_value() -> None:
    with pytest.raises(ExternalIOError) as failure:
        map_output(
            receipt([{"text": "long remote value"}]),
            [OutputField(name="text", kind="string", has_default=True, default="long fallback")],
            scope=SCOPE,
            materializer=None,
            max_variable_bytes=3,
        )
    assert failure.value.code == "output_variable_too_large"
