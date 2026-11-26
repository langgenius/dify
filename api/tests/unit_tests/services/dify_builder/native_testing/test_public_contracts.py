from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt


def test_public_receipt_has_no_private_execution_fields() -> None:
    schema = NativeTestPublicReceipt.model_json_schema()
    assert set(schema["properties"]) == {
        "schema_version",
        "request_id",
        "generation",
        "version",
        "status",
        "wait_reason",
        "native_run_id",
        "native_status",
        "pending",
        "outcome",
        "evidence_refs",
        "cancellation",
        "decision_public_revision",
        "can_resume",
        "resume_blocked_reason",
        "canvas_path",
    }
    assert schema["additionalProperties"] is False
