import base64
from typing import override

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


def test_stricter_document_cap_does_not_shrink_the_independent_image_cap() -> None:
    """A 2/3/6 MiB deployment preserves image, document and aggregate limits.

    The bounded reader rejects a requested read cap below the authorized file's
    size, so this exercises the real adapter's contract rather than accepting a
    stub that ignores max_bytes. Larger read admission cannot relax MIME caps.
    """
    mib = 1024 * 1024
    limits = FileLimits(max_document_bytes=2 * mib, max_image_bytes=3 * mib, max_total_bytes=6 * mib)

    class BoundedReader(AuthorizedReader):
        @override
        def read_authorized(self, scope: FileScope, reference: FileReference, *, max_bytes: int) -> FileBlob:
            blob = super().read_authorized(scope, reference, max_bytes=max_bytes)
            if len(blob.data) > max_bytes:
                raise ExternalIOError("file_too_large", "The authorized file exceeds the requested read budget.")
            return blob

    image = FileBlob(filename="exact.png", media_type="image/png", data=b"i" * (3 * mib))
    reader = BoundedReader(
        {
            "image": image,
            "document": FileBlob(filename="exact.pdf", media_type="application/pdf", data=b"d" * (2 * mib)),
            "oversized-document": FileBlob(
                filename="over.pdf", media_type="application/pdf", data=b"d" * (2 * mib + 1)
            ),
            "extra": FileBlob(filename="extra.txt", media_type="text/plain", data=b"x"),
        }
    )
    modes = ["text/plain", "image/png", "application/pdf"]
    parts = build_input_parts(
        "Exactly six MiB of images",
        [FileReference(file_id="image"), FileReference(file_id="image")],
        scope=SCOPE,
        reader=reader,
        agent_input_modes=modes,
        limits=limits,
    )
    assert len(parts) == 3
    for part in parts[1:]:
        raw = part["raw"]
        assert isinstance(raw, str)
        assert base64.b64decode(raw) == image.data
    document = build_input_parts(
        "Exactly two MiB of document",
        [FileReference(file_id="document")],
        scope=SCOPE,
        reader=reader,
        agent_input_modes=modes,
        limits=limits,
    )
    assert len(document) == 2
    with pytest.raises(ExternalIOError) as error:
        build_input_parts(
            "Document limit is still enforced",
            [FileReference(file_id="oversized-document")],
            scope=SCOPE,
            reader=reader,
            agent_input_modes=modes,
            limits=limits,
        )
    assert error.value.code == "file_too_large"
    with pytest.raises(ExternalIOError) as error:
        build_input_parts(
            "Aggregate limit is still enforced",
            [FileReference(file_id="image"), FileReference(file_id="image"), FileReference(file_id="extra")],
            scope=SCOPE,
            reader=reader,
            agent_input_modes=modes,
            limits=limits,
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
