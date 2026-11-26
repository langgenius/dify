"""Regression tests for tool-stream message validation and blob chunk merging.

Agent V2 talks to the plugin daemon through its own copy of the tool-stream
message model. A tool that emits an operation log via the plugin SDK's
``create_log_message`` leaves ``metadata`` unset, and the daemon serializes it
onto the wire as ``metadata: null``. The canonical core model
(``core.tools.entities.tool_entities.ToolInvokeMessage.LogMessage``) normalizes
that null to ``{}``; Agent V2's copy must do the same, otherwise every such log
message collapses the whole ``message`` union and the tool invocation fails with
``N validation errors for DifyPluginToolInvokeMessage``.

See langgenius/dify-official-plugins#3512.

Blob chunk merging validates the plugin-declared size before allocating.
"""

from __future__ import annotations

import base64
import json

import httpx
import pytest
from pydantic import ValidationError

from dify_agent.layers.dify_plugin.tool_client import (
    DifyPluginDaemonToolClient,
    DifyPluginToolClientError,
    DifyPluginToolInvokeMessage,
    merge_blob_chunks,
)


def test_log_message_with_null_metadata_normalizes_to_empty_dict() -> None:
    """A LogMessage whose ``metadata`` is null must validate, not raise.

    This is the exact wire shape produced when a plugin tool calls
    ``create_log_message(label=..., data=..., status=...)`` without passing
    ``metadata`` (the SDK default), e.g. the Google Calendar tool.
    """
    message = DifyPluginToolInvokeMessage.model_validate(
        {
            "type": "log",
            "message": {
                "id": "log-1",
                "label": "Search Events Operation",
                "status": "success",
                "data": {"calendar_id": "primary"},
                "metadata": None,
            },
        }
    )

    assert isinstance(message.message, DifyPluginToolInvokeMessage.LogMessage)
    assert message.message.metadata == {}


def test_log_message_with_omitted_metadata_still_validates() -> None:
    """Omitting ``metadata`` entirely must also validate to an empty dict."""
    message = DifyPluginToolInvokeMessage.model_validate(
        {
            "type": "log",
            "message": {
                "id": "log-2",
                "label": "Fetching Top Stories",
                "status": "success",
                "data": {"limit": 10},
            },
        }
    )

    assert isinstance(message.message, DifyPluginToolInvokeMessage.LogMessage)
    assert message.message.metadata == {}


def blob_chunk(
    *, chunk_id: str, sequence: int, total_length: int, blob: bytes, end: bool
) -> DifyPluginToolInvokeMessage:
    return DifyPluginToolInvokeMessage(
        type=DifyPluginToolInvokeMessage.MessageType.BLOB_CHUNK,
        message=DifyPluginToolInvokeMessage.BlobChunkMessage(
            id=chunk_id,
            sequence=sequence,
            total_length=total_length,
            blob=blob,
            end=end,
        ),
    )


def test_merge_blob_chunks_rejects_declared_length_above_limit() -> None:
    """A declared length above the limit fails before the buffer is allocated."""
    chunks = [blob_chunk(chunk_id="file1", sequence=0, total_length=1025, blob=b"x", end=False)]

    with pytest.raises(ValueError, match="File is too large"):
        merge_blob_chunks(chunks, max_file_size=1024)


def test_merge_blob_chunks_rejects_unallocatable_declared_length() -> None:
    """An absurd declared length raises ValueError instead of MemoryError."""
    chunks = [blob_chunk(chunk_id="file1", sequence=0, total_length=2**62, blob=b"x", end=False)]

    with pytest.raises(ValueError, match="File is too large"):
        merge_blob_chunks(chunks)


def test_merge_blob_chunks_accepts_declared_length_at_the_limit() -> None:
    """A declared length exactly at the limit is still accepted and merged."""
    chunks = [
        blob_chunk(chunk_id="file1", sequence=0, total_length=1024, blob=b"abc", end=False),
        blob_chunk(chunk_id="file1", sequence=1, total_length=1024, blob=b"defg", end=True),
    ]

    merged = merge_blob_chunks(chunks, max_file_size=1024)

    assert len(merged) == 1
    assert merged[0].type is DifyPluginToolInvokeMessage.MessageType.BLOB
    assert isinstance(merged[0].message, DifyPluginToolInvokeMessage.BlobMessage)
    assert merged[0].message.blob == b"abcdefg"


def test_merge_blob_chunks_keeps_non_chunk_messages_in_order() -> None:
    """Text messages around blob chunks still pass through in stream order."""
    chunks = [
        DifyPluginToolInvokeMessage(
            type=DifyPluginToolInvokeMessage.MessageType.TEXT,
            message=DifyPluginToolInvokeMessage.TextMessage(text="before"),
        ),
        blob_chunk(chunk_id="file1", sequence=0, total_length=1, blob=b"x", end=True),
        DifyPluginToolInvokeMessage(
            type=DifyPluginToolInvokeMessage.MessageType.TEXT,
            message=DifyPluginToolInvokeMessage.TextMessage(text="after"),
        ),
    ]

    merged = merge_blob_chunks(chunks)

    assert [message.type for message in merged] == [
        DifyPluginToolInvokeMessage.MessageType.TEXT,
        DifyPluginToolInvokeMessage.MessageType.BLOB,
        DifyPluginToolInvokeMessage.MessageType.TEXT,
    ]


def test_merge_blob_chunks_preserves_per_file_metadata_and_later_updates() -> None:
    first = blob_chunk(chunk_id="one", sequence=0, total_length=2, blob=b"a", end=False)
    first.meta = {"filename": "one.pdf", "mime_type": "application/octet-stream"}
    second = blob_chunk(chunk_id="two", sequence=0, total_length=1, blob=b"c", end=True)
    second.meta = {"filename": "two.png", "mime_type": "image/png"}
    update = blob_chunk(chunk_id="one", sequence=1, total_length=2, blob=b"b", end=False)
    update.meta = {"mime_type": "application/pdf"}
    final = blob_chunk(chunk_id="one", sequence=2, total_length=2, blob=b"", end=True)

    merged = merge_blob_chunks([first, second, update, final])

    assert [message.meta for message in merged] == [
        {"filename": "two.png", "mime_type": "image/png"},
        {"filename": "one.pdf", "mime_type": "application/pdf"},
    ]
    assert first.meta == {"filename": "one.pdf", "mime_type": "application/octet-stream"}


def test_wire_payload_cannot_inject_chunk_error() -> None:
    message = DifyPluginToolInvokeMessage.model_validate(
        {
            "type": "blob_chunk",
            "message": None,
            "_chunk_error": "spoofed",
            "chunk_error": "spoofed",
        }
    )

    assert message.chunk_error is None
    assert "chunk_error" not in message.model_dump()


@pytest.mark.parametrize(
    ("raw_blob", "expected"),
    [
        (b"raw-bytes", b"raw-bytes"),
        (bytearray(b"mut-bytes"), b"mut-bytes"),
        (base64.b64encode(b"wire-bytes").decode(), b"wire-bytes"),
        ("", b""),
    ],
)
def test_blob_and_blob_chunk_accept_bytes_bytearray_and_valid_base64(raw_blob: object, expected: bytes) -> None:
    blob_message = DifyPluginToolInvokeMessage.model_validate({"type": "blob", "message": {"blob": raw_blob}})
    chunk_message = DifyPluginToolInvokeMessage.model_validate(
        {
            "type": "blob_chunk",
            "message": {
                "id": "f1",
                "sequence": 0,
                "total_length": len(expected),
                "blob": raw_blob,
                "end": True,
            },
        }
    )

    assert isinstance(blob_message.message, DifyPluginToolInvokeMessage.BlobMessage)
    assert blob_message.message.blob == expected
    assert isinstance(chunk_message.message, DifyPluginToolInvokeMessage.BlobChunkMessage)
    assert chunk_message.message.blob == expected


@pytest.mark.parametrize("bad_blob", ["bad!", "abc", "YQ==!", "中文", 123, None])
def test_strict_validation_rejects_invalid_base64_for_blob_and_blob_chunk(bad_blob: object) -> None:
    with pytest.raises(ValidationError):
        DifyPluginToolInvokeMessage.model_validate({"type": "blob", "message": {"blob": bad_blob}})

    with pytest.raises(ValidationError):
        DifyPluginToolInvokeMessage.model_validate(
            {
                "type": "blob_chunk",
                "message": {
                    "id": "f1",
                    "sequence": 0,
                    "total_length": 4,
                    "blob": bad_blob,
                    "end": True,
                },
            }
        )


def test_merge_blob_chunks_raises_when_isolation_disabled_on_decode_errors() -> None:
    bad_blob = DifyPluginToolInvokeMessage.model_validate(
        {"type": "blob", "message": {"blob": "bad!"}, "meta": {"filename": "broken.pdf"}},
        context={"isolate_blob_errors": True},
    )
    bad_chunk = DifyPluginToolInvokeMessage.model_validate(
        {
            "type": "blob_chunk",
            "message": {"id": "c1", "sequence": 0, "total_length": 4, "blob": "abc", "end": True},
            "meta": {"filename": "broken_chunk.pdf"},
        },
        context={"isolate_blob_errors": True},
    )

    with pytest.raises(ValueError, match="Invalid base64-encoded blob payload"):
        merge_blob_chunks([bad_blob], isolate_errors=False)

    with pytest.raises(ValueError, match="Invalid base64-encoded blob payload"):
        merge_blob_chunks([bad_chunk], isolate_errors=False)


def test_merge_blob_chunks_locks_chunk_id_failure_on_invalid_base64_and_preserves_siblings() -> None:
    bad_blob = DifyPluginToolInvokeMessage.model_validate(
        {"type": "blob", "message": {"blob": "bad!"}, "meta": {"filename": "bad-single.pdf"}},
        context={"isolate_blob_errors": True},
    )
    chunk_0_ok = DifyPluginToolInvokeMessage.model_validate(
        {
            "type": "blob_chunk",
            "message": {
                "id": "mid-fail",
                "sequence": 0,
                "total_length": 6,
                "blob": base64.b64encode(b"ab").decode(),
                "end": False,
            },
            "meta": {"filename": "mid-fail.pdf"},
        },
        context={"isolate_blob_errors": True},
    )
    chunk_1_bad = DifyPluginToolInvokeMessage.model_validate(
        {
            "type": "blob_chunk",
            "message": {
                "id": "mid-fail",
                "sequence": 1,
                "total_length": 6,
                "blob": "not-valid-base64!",
                "end": False,
            },
            "meta": {"mime_type": "application/pdf"},
        },
        context={"isolate_blob_errors": True},
    )
    chunk_2_after_fail = DifyPluginToolInvokeMessage.model_validate(
        {
            "type": "blob_chunk",
            "message": {
                "id": "mid-fail",
                "sequence": 2,
                "total_length": 6,
                "blob": base64.b64encode(b"ef").decode(),
                "end": True,
            },
        },
        context={"isolate_blob_errors": True},
    )
    good_chunk = blob_chunk(chunk_id="good", sequence=0, total_length=2, blob=b"ok", end=True)
    good_chunk.meta = {"filename": "good.png", "mime_type": "image/png"}

    merged = merge_blob_chunks(
        [bad_blob, chunk_0_ok, chunk_1_bad, chunk_2_after_fail, good_chunk],
        isolate_errors=True,
    )

    assert len(merged) == 3
    assert merged[0].type is DifyPluginToolInvokeMessage.MessageType.BLOB
    assert merged[0].message is None
    assert merged[0].chunk_error == "Invalid base64-encoded blob payload"
    assert merged[0].meta == {"filename": "bad-single.pdf"}

    assert merged[1].type is DifyPluginToolInvokeMessage.MessageType.BLOB_CHUNK
    assert merged[1].message is None
    assert merged[1].chunk_error == "Invalid base64-encoded blob payload"
    assert merged[1].meta == {"filename": "mid-fail.pdf", "mime_type": "application/pdf", "size": 6}

    assert merged[2].type is DifyPluginToolInvokeMessage.MessageType.BLOB
    assert isinstance(merged[2].message, DifyPluginToolInvokeMessage.BlobMessage)
    assert merged[2].message.blob == b"ok"
    assert merged[2].meta == {"filename": "good.png", "mime_type": "image/png"}


def test_merge_blob_chunks_isolates_failures_and_incomplete_streams() -> None:
    negative_len = blob_chunk(chunk_id="neg-len", sequence=0, total_length=-1, blob=b"x", end=False)
    negative_len.meta = {"filename": "negative.bin"}

    bad_declared_0 = blob_chunk(chunk_id="bad-declared", sequence=0, total_length=2048, blob=b"x", end=False)
    bad_declared_0.meta = {"filename": "huge.pdf"}
    bad_declared_1 = blob_chunk(chunk_id="bad-declared", sequence=1, total_length=2048, blob=b"y", end=True)
    bad_declared_1.meta = {"mime_type": "application/pdf"}
    bad_declared_stray = blob_chunk(chunk_id="bad-declared", sequence=2, total_length=2048, blob=b"z", end=True)

    overflow_max_0 = blob_chunk(chunk_id="overflow-max", sequence=0, total_length=10, blob=b"123456", end=False)
    overflow_max_0.meta = {"filename": "grow.bin"}
    overflow_max_1 = blob_chunk(chunk_id="overflow-max", sequence=1, total_length=10, blob=b"789012", end=False)
    overflow_max_2 = blob_chunk(chunk_id="overflow-max", sequence=2, total_length=10, blob=b"!", end=True)

    oversized_chunk_0 = blob_chunk(chunk_id="big-chunk", sequence=0, total_length=10, blob=b"123456789", end=False)
    oversized_chunk_0.meta = {"filename": "wide.bin"}
    oversized_chunk_1 = blob_chunk(chunk_id="big-chunk", sequence=1, total_length=10, blob=b"0", end=True)

    truncated = blob_chunk(chunk_id="truncated", sequence=0, total_length=6, blob=b"abc", end=True)
    truncated.meta = {"filename": "short.pdf"}

    skipped_seq_0 = blob_chunk(chunk_id="skipped-seq", sequence=0, total_length=6, blob=b"abc", end=False)
    skipped_seq_0.meta = {"filename": "gap.pdf"}
    skipped_seq_1 = blob_chunk(chunk_id="skipped-seq", sequence=2, total_length=6, blob=b"def", end=True)

    changed_len_0 = blob_chunk(chunk_id="changed-len", sequence=0, total_length=6, blob=b"abc", end=False)
    changed_len_0.meta = {"filename": "mismatch.pdf"}
    changed_len_1 = blob_chunk(chunk_id="changed-len", sequence=1, total_length=8, blob=b"def", end=True)

    exceeded_declared_0 = blob_chunk(chunk_id="over-declared", sequence=0, total_length=4, blob=b"abc", end=False)
    exceeded_declared_0.meta = {"filename": "extra.pdf"}
    exceeded_declared_1 = blob_chunk(chunk_id="over-declared", sequence=1, total_length=4, blob=b"de", end=False)

    malformed = DifyPluginToolInvokeMessage(
        type=DifyPluginToolInvokeMessage.MessageType.BLOB_CHUNK,
        message=None,
        meta={"filename": "malformed.bin"},
    )

    incomplete = blob_chunk(chunk_id="dangling", sequence=0, total_length=10, blob=b"hi", end=False)
    incomplete.meta = {"filename": "partial.bin"}

    ok_0 = blob_chunk(chunk_id="ok", sequence=0, total_length=5, blob=b"he", end=False)
    ok_0.meta = {"filename": "ok.txt"}
    ok_1 = blob_chunk(chunk_id="ok", sequence=1, total_length=5, blob=b"llo", end=True)

    merged = merge_blob_chunks(
        [
            negative_len,
            bad_declared_0,
            overflow_max_0,
            ok_0,
            overflow_max_1,
            oversized_chunk_0,
            truncated,
            skipped_seq_0,
            changed_len_0,
            exceeded_declared_0,
            malformed,
            incomplete,
            bad_declared_1,
            bad_declared_stray,
            overflow_max_2,
            oversized_chunk_1,
            skipped_seq_1,
            changed_len_1,
            exceeded_declared_1,
            ok_1,
        ],
        max_file_size=10,
        max_chunk_size=8,
        isolate_errors=True,
    )

    blobs = [item for item in merged if item.type is DifyPluginToolInvokeMessage.MessageType.BLOB]
    assert len(blobs) == 1
    assert isinstance(blobs[0].message, DifyPluginToolInvokeMessage.BlobMessage)
    assert blobs[0].message.blob == b"hello"
    assert blobs[0].meta == {"filename": "ok.txt"}

    failed_by_name = {
        (item.meta or {}).get("filename"): item
        for item in merged
        if item.type is DifyPluginToolInvokeMessage.MessageType.BLOB_CHUNK
    }
    assert len(failed_by_name) == len(merged) - 1 == 10
    assert failed_by_name["negative.bin"].chunk_error == "Invalid blob chunk total_length: -1"
    assert failed_by_name["negative.bin"].meta == {"filename": "negative.bin"}
    assert failed_by_name["huge.pdf"].chunk_error is not None
    assert "File is too large" in failed_by_name["huge.pdf"].chunk_error
    assert failed_by_name["huge.pdf"].meta == {
        "filename": "huge.pdf",
        "mime_type": "application/pdf",
        "size": 2048,
    }
    assert failed_by_name["grow.bin"].chunk_error is not None
    assert "File is too large" in failed_by_name["grow.bin"].chunk_error
    assert failed_by_name["wide.bin"].chunk_error is not None
    assert "File chunk is too large" in failed_by_name["wide.bin"].chunk_error
    for name in ("short.pdf", "gap.pdf", "mismatch.pdf", "extra.pdf"):
        assert failed_by_name[name].chunk_error == "Plugin file chunks have an invalid sequence or length"
    assert failed_by_name["malformed.bin"].chunk_error == "Blob chunk responses must carry BlobChunkMessage payloads."
    assert failed_by_name["partial.bin"].chunk_error is None
    assert failed_by_name["partial.bin"].message is None


@pytest.mark.anyio
async def test_daemon_tool_client_isolates_invalid_base64_blob_and_chunk_in_stream() -> None:
    frames = [
        {"type": "text", "message": {"text": "lead:"}},
        {"type": "blob", "message": {"blob": "bad!"}, "meta": {"filename": "corrupt.png", "mime_type": "image/png"}},
        {
            "type": "blob_chunk",
            "message": {
                "id": "bad-chunk",
                "sequence": 0,
                "total_length": 4,
                "blob": "abc",
                "end": False,
            },
            "meta": {"filename": "corrupt.pdf", "mime_type": "application/pdf"},
        },
        {
            "type": "blob_chunk",
            "message": {
                "id": "bad-chunk",
                "sequence": 1,
                "total_length": 4,
                "blob": base64.b64encode(b"xy").decode(),
                "end": True,
            },
        },
        {
            "type": "blob",
            "message": {"blob": base64.b64encode(b"valid").decode()},
            "meta": {"filename": "valid.png", "mime_type": "image/png"},
        },
    ]
    stream_body = "".join(f"data: {json.dumps({'code': 0, 'message': '', 'data': frame})}\n" for frame in frames)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=stream_body)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = DifyPluginDaemonToolClient(
            plugin_daemon_url="http://daemon.test",
            plugin_daemon_api_key="secret",
            tenant_id="tenant",
            plugin_id="files",
            user_id="user",
            http_client=http_client,
        )
        merged = await client.invoke(
            provider="files",
            tool_name="create",
            credential_type="unauthorized",
            credentials={},
            tool_parameters={},
        )

    assert len(merged) == 4
    assert merged[0].type is DifyPluginToolInvokeMessage.MessageType.TEXT
    assert merged[1].type is DifyPluginToolInvokeMessage.MessageType.BLOB
    assert merged[1].message is None
    assert merged[1].chunk_error == "Invalid base64-encoded blob payload"
    assert merged[1].meta == {"filename": "corrupt.png", "mime_type": "image/png"}
    assert merged[2].type is DifyPluginToolInvokeMessage.MessageType.BLOB_CHUNK
    assert merged[2].message is None
    assert merged[2].chunk_error == "Invalid base64-encoded blob payload"
    assert merged[2].meta == {"filename": "corrupt.pdf", "mime_type": "application/pdf", "size": 4}
    assert merged[3].type is DifyPluginToolInvokeMessage.MessageType.BLOB
    assert isinstance(merged[3].message, DifyPluginToolInvokeMessage.BlobMessage)
    assert merged[3].message.blob == b"valid"


@pytest.mark.anyio
async def test_daemon_tool_client_uses_configured_max_file_size_for_blob_chunks() -> None:
    chunk_size = 8192
    chunk_count = (30 * 1024 * 1024 // chunk_size) + 1  # 3841 chunks = 30 MiB + 8 KiB
    declared_length = chunk_count * chunk_size
    encoded_chunk = base64.b64encode(b"a" * chunk_size).decode()

    lines = [
        f"data: {json.dumps({'code': 0, 'message': '', 'data': {'type': 'text', 'message': {'text': 'summary:'}}})}\n"
    ]
    for sequence in range(chunk_count):
        frame: dict[str, object] = {
            "type": "blob_chunk",
            "message": {
                "id": "f1",
                "sequence": sequence,
                "total_length": declared_length,
                "blob": encoded_chunk,
                "end": sequence == chunk_count - 1,
            },
        }
        if sequence == 0:
            frame["meta"] = {"filename": "large.bin"}
        lines.append(f"data: {json.dumps({'code': 0, 'message': '', 'data': frame})}\n")
    stream_body = "".join(lines)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=stream_body)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        allowing_client = DifyPluginDaemonToolClient(
            plugin_daemon_url="http://daemon.test",
            plugin_daemon_api_key="secret",
            tenant_id="tenant",
            plugin_id="files",
            user_id="user",
            http_client=http_client,
            max_file_size=50 * 1024 * 1024,
        )
        merged = await allowing_client.invoke(
            provider="files",
            tool_name="create",
            credential_type="unauthorized",
            credentials={},
            tool_parameters={},
        )
        assert len(merged) == 2
        assert merged[0].type is DifyPluginToolInvokeMessage.MessageType.TEXT
        assert isinstance(merged[0].message, DifyPluginToolInvokeMessage.TextMessage)
        assert merged[0].message.text == "summary:"
        assert merged[1].type is DifyPluginToolInvokeMessage.MessageType.BLOB
        assert isinstance(merged[1].message, DifyPluginToolInvokeMessage.BlobMessage)
        assert len(merged[1].message.blob) == declared_length
        assert merged[1].message.blob == b"a" * declared_length
        assert merged[1].meta == {"filename": "large.bin"}

        rejecting_client = DifyPluginDaemonToolClient(
            plugin_daemon_url="http://daemon.test",
            plugin_daemon_api_key="secret",
            tenant_id="tenant",
            plugin_id="files",
            user_id="user",
            http_client=http_client,
            max_file_size=30 * 1024 * 1024,
        )
        isolated = await rejecting_client.invoke(
            provider="files",
            tool_name="create",
            credential_type="unauthorized",
            credentials={},
            tool_parameters={},
        )
        assert len(isolated) == 2
        assert isolated[0].type is DifyPluginToolInvokeMessage.MessageType.TEXT
        assert isinstance(isolated[0].message, DifyPluginToolInvokeMessage.TextMessage)
        assert isolated[0].message.text == "summary:"
        assert isolated[1].type is DifyPluginToolInvokeMessage.MessageType.BLOB_CHUNK
        assert isolated[1].message is None
        assert isolated[1].chunk_error is not None and "File is too large" in isolated[1].chunk_error
        assert isolated[1].meta == {"filename": "large.bin", "size": declared_length}


@pytest.mark.anyio
@pytest.mark.parametrize(
    "stream_body",
    [
        "data: {not-valid-json\n",
        f"data: {json.dumps({'code': 0, 'message': '', 'data': {'type': 'text', 'message': {}}})}\n",
        f"data: {json.dumps({'code': 0, 'message': '', 'data': {'type': 'blob_chunk', 'message': {'id': 'f1', 'blob': 'bad!'}}})}\n",
    ],
)
async def test_daemon_tool_client_wraps_invalid_stream_validation_errors(stream_body: str) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=stream_body)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
        client = DifyPluginDaemonToolClient(
            plugin_daemon_url="http://daemon.test",
            plugin_daemon_api_key="secret",
            tenant_id="tenant",
            plugin_id="files",
            user_id="user",
            http_client=http_client,
        )
        with pytest.raises(DifyPluginToolClientError) as exc_info:
            await client.invoke(
                provider="files",
                tool_name="create",
                credential_type="unauthorized",
                credentials={},
                tool_parameters={},
            )

    assert exc_info.value.error_type == "PluginDaemonBadResponseError"
