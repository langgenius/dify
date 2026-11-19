"""Content boundaries cannot turn telemetry opt-in into file or credential access."""

import json

import pytest

from services.external_agents.trace_content import admitted_trace_parts, operation_trace_input, safe_trace_content
from services.external_agents.traceability import TraceLimits, redact_trace_data


@pytest.mark.parametrize("value", [0, False, "", [], {}, None])
def test_content_preserves_reported_json_values(value: object) -> None:
    assert safe_trace_content(value, limits=TraceLimits(), secrets=()) == value


@pytest.mark.parametrize("value", [0, False, "", [], {}])
def test_both_supported_operation_input_profiles_keep_explicit_values(value: object) -> None:
    assert operation_trace_input({"step_action": {"tool_invocation": {"parameters": value}}}, kind="tool") == value
    assert operation_trace_input({"step_action": {"agent_invocation": {"requests": value}}}, kind="agent") == value
    assert operation_trace_input({"name": "sample", "parameters": value}, kind="tool") == value
    assert operation_trace_input({"name": "sample", "requests": value}, kind="agent") == value


def test_operation_metadata_and_nested_response_trace_are_not_operation_output() -> None:
    assert operation_trace_input({"metadata": {"input": "not a request"}}, kind="agent") is None
    assert (
        operation_trace_input(
            {"step_action": {"agent_invocation": {"response_trace": {"input": "nested"}}}}, kind="agent"
        )
        is None
    )


def test_secret_and_long_signed_url_are_removed_before_display_truncation() -> None:
    limits = TraceLimits(max_string_chars=16)
    assert "hidden" not in str(safe_trace_content("x" * 12 + "hidden-token", limits=limits, secrets=("hidden-token",)))
    signed = "https://files.example/" + "x" * 128 + "?timestamp=1&nonce=abc&sign=capability"
    assert safe_trace_content(signed, limits=limits, secrets=()) == "[redacted URL]"
    result = safe_trace_content({"prefix-hidden-token": "safe"}, limits=TraceLimits(), secrets=("hidden-token",))
    assert result == {"prefix-[redacted]": "safe"}


@pytest.mark.parametrize("uri", ["data:image/png;base64,YWJj", "data:text/plain,private%20body"])
def test_file_summaries_strip_authority_and_both_data_uri_forms(uri: str) -> None:
    result = safe_trace_content(
        {
            "file": {
                "dify_model_identity": "__dify__file__",
                "filename": "report-hidden-token.txt",
                "mime_type": "text/plain",
                "size": 3,
                "tenant_id": "private",
                "id": "private-id",
                "url": "https://files.example/a?sign=secret",
                "raw": "file-body",
            },
            "data": uri,
            "bytes": "file-body",
            "Authorization": "Bearer hidden-token",
            "ordinary": "metadata:foo",
        },
        limits=TraceLimits(),
        secrets=("hidden-token",),
    )
    assert result == {
        "file": {"filename": "report-[redacted].txt", "mime_type": "text/plain", "size": 3},
        "data": "[redacted file]",
        "bytes": "[redacted]",
        "Authorization": "[redacted]",
        "ordinary": "metadata:foo",
    }
    assert "private" not in json.dumps(result)


def test_total_json_budget_rejects_oversized_nested_content_without_expansion() -> None:
    assert (
        safe_trace_content({"items": ["x" * 100 for _ in range(100)]}, limits=TraceLimits(max_bytes=256), secrets=())
        is None
    )
    assert (
        safe_trace_content(
            {"nested": json.dumps({"nested": "x" * 1024})}, limits=TraceLimits(max_bytes=256), secrets=()
        )
        is None
    )
    assert safe_trace_content({"file": b"binary"}, limits=TraceLimits(), secrets=()) is None


def test_data_uri_after_chinese_text_is_removed_without_matching_metadata_word() -> None:
    assert safe_trace_content("文件data:text/plain,private", limits=TraceLimits(), secrets=()) == "文件[redacted file]"
    assert safe_trace_content("metadata:foo", limits=TraceLimits(), secrets=()) == "metadata:foo"


def test_json_string_expansion_cannot_bypass_secret_field_redaction() -> None:
    value = json.dumps({"password": "sensitive-field", "padding": "x" * 4000})
    result = safe_trace_content(value, limits=TraceLimits(max_string_chars=16000), secrets=("x",))
    assert "sensitive-field" not in str(result)


@pytest.mark.parametrize(("field", "secret"), [("password", "password"), ("password", "s"), ("raw", "raw")])
@pytest.mark.parametrize("encoded", [False, True])
def test_original_sensitive_label_is_protected_before_secret_key_renaming(
    field: str, secret: str, encoded: bool
) -> None:
    payload = {"nested": {field: "private-value"}}
    value = json.dumps(payload) if encoded else payload
    assert "private-value" not in str(safe_trace_content(value, limits=TraceLimits(), secrets=(secret,)))


def test_file_identity_is_resolved_before_secret_substitution() -> None:
    value = {
        "dify_model_identity": "__dify__file__",
        "filename": "safe.txt",
        "url": "https://private.example",
        "id": "private-id",
    }
    assert safe_trace_content(value, limits=TraceLimits(), secrets=("__dify__file__",)) == {"filename": "safe.txt"}


@pytest.mark.parametrize(
    "uri",
    [
        "https://owned.invalid/" + "x" * 300 + "?timestamp=1&nonce=OWN_NONCE&sign=OWN_SIGN_CAP",
        "https://owned.invalid/file?signature=OWN_SIGNATURE",
        "https://owned.invalid/file?token=OWN_TOKEN",
        "https://user:OWN_PASSWORD@owned.invalid/file",
        "data:text/plain,OWN_BODY",
        "data:image/png;base64,T1dOX0JPRFk=",
    ],
)
@pytest.mark.parametrize("uppercase", [False, True])
@pytest.mark.parametrize("key_location", [False, True])
def test_keys_and_values_share_authority_scrub_before_truncation(uri: str, uppercase: bool, key_location: bool) -> None:
    if uppercase:
        uri = uri.replace("https://", "HTTPS://").replace("data:", "DATA:")
    expected = "[redacted file]" if uri.lower().startswith("data:") else "[redacted URL]"
    value = {uri: "owned-synthetic"} if key_location else uri
    result = safe_trace_content(value, limits=TraceLimits(max_string_chars=16), secrets=())
    assert result == ({expected: "owned-synthetic"} if key_location else expected)


@pytest.mark.parametrize(
    "parts",
    [
        [{"raw": "base64"}],
        [{"fileRef": {"file_id": "id", "kind": "upload", "url": "https://files.example"}}],
        [{"text": 0}],
    ],
)
def test_non_admitted_wire_parts_remain_unavailable(parts: object) -> None:
    assert admitted_trace_parts(parts) is None


def test_ingestion_key_masking_precedes_truncation_and_legacy_keys_are_conservative() -> None:
    credential = "OWN_LONG_BEARER_3056_" + "x" * 384
    raw = redact_trace_data({credential: "owned-synthetic"}, limits=TraceLimits(), secrets=(credential,))
    assert credential[:24] not in json.dumps(raw)
    projected = safe_trace_content(raw, limits=TraceLimits(), secrets=(credential,))
    assert credential[:24] not in json.dumps(projected)
    legacy = safe_trace_content({credential[:256]: "owned-synthetic"}, limits=TraceLimits(), secrets=(credential,))
    assert legacy == {"[redacted key]": "owned-synthetic"}
