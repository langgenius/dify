import base64

import pytest

from services.external_agents.file_profile import FileLimits, build_input_parts, render_task_value
from services.external_agents.io_contracts import ExternalIOError, FileBlob, FileReference, FileScope, JsonValue

SCOPE = FileScope(tenant_id="tenant", app_id=None, actor_id="actor", invocation_id="inv", lease_id="lease")


class AuthorizedReader:
    def __init__(self, blobs: dict[str, FileBlob]) -> None:
        self.blobs = blobs
        self.calls: list[str] = []

    def read_authorized(self, scope: FileScope, reference: FileReference, *, max_bytes: int) -> FileBlob:
        assert scope == SCOPE
        assert max_bytes > 0
        self.calls.append(reference.file_id)
        return self.blobs[reference.file_id]


def test_file_bytes_are_ordered_and_no_dify_url_leaks() -> None:
    reader = AuthorizedReader(
        {
            "a": FileBlob(filename="a.pdf", media_type="application/pdf", data=b"pdf"),
            "b": FileBlob(filename="b.md", media_type="text/x-markdown", data=b"md"),
        }
    )
    parts = build_input_parts(
        "Review",
        [FileReference(file_id="a"), FileReference(file_id="b")],
        scope=SCOPE,
        reader=reader,
        agent_input_modes=["text/plain", "application/pdf", "text/markdown"],
    )
    assert reader.calls == ["a", "b"]
    assert [part.get("filename") for part in parts] == [None, "a.pdf", "b.md"]
    raw = parts[1]["raw"]
    assert isinstance(raw, str)
    assert base64.b64decode(raw) == b"pdf"
    assert all("url" not in part for part in parts)


def test_skill_pdf_does_not_expand_agent_defaults() -> None:
    reader = AuthorizedReader({"a": FileBlob(filename="a.pdf", media_type="application/pdf", data=b"pdf")})
    with pytest.raises(ExternalIOError) as error:
        build_input_parts(
            "Review", [FileReference(file_id="a")], scope=SCOPE, reader=reader, agent_input_modes=["text/plain"]
        )
    assert error.value.code == "agent_file_mode_unsupported"


def test_total_file_limit_fails_without_truncation() -> None:
    reader = AuthorizedReader({"a": FileBlob(filename="a.txt", media_type="text/plain", data=b"aaaa")})
    with pytest.raises(ExternalIOError) as error:
        build_input_parts(
            "Review",
            [FileReference(file_id="a"), FileReference(file_id="a")],
            scope=SCOPE,
            reader=reader,
            agent_input_modes=["text/plain"],
            limits=FileLimits(max_total_bytes=6),
        )
    assert error.value.code == "file_total_too_large"


@pytest.mark.parametrize(
    "value", [{"nested": [{"dify_model_identity": "__dify__file__", "url": "secret"}]}, float("inf")]
)
def test_no_nested_file_stringification_or_nonfinite_number(value: JsonValue) -> None:
    with pytest.raises(ExternalIOError):
        render_task_value(value)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (False, "false"),
        (0, "0"),
        ([], "[]"),
        ({"a": False}, '{"a":false}'),
        ({"transfer_method": "wire"}, '{"transfer_method":"wire"}'),
    ],
)
def test_ordinary_values_keep_exact_meaning(value: JsonValue, expected: str) -> None:
    assert render_task_value(value) == expected
