"""Strict wire evidence never derives authority from model output."""

import pytest
from pydantic import ValidationError

from dify_agent.protocol import native_testing


def test_shell_job_receipt_and_old_payload_wire():
    receipt_type = native_testing.AgentShellJobReceipt
    wire = dict(binding_ref="binding:workspace", job_id="job", status="running", done=False, exit_code=None)
    receipt = receipt_type.model_validate_json(__import__("json").dumps(wire))
    assert receipt.model_dump(mode="json") == wire
    from tests.local.dify_agent.runtime.test_native_effects import REF, INTENT

    payload = native_testing.AgentStoreResultPayload(ref=REF, key=INTENT.key, result="<metadata>fabricated</metadata>")
    assert payload.shell_job is None
    assert (
        native_testing.AgentStoreResultPayload.model_validate_json(
            payload.model_copy(update={"shell_job": receipt}).model_dump_json()
        ).shell_job
        == receipt
    )
    for changes in (
        {"done": "false"},
        {"exit_code": True},
        {"job_id": ""},
        {"status": "unknown"},
        {"done": True},
        {"exit_code": 0},
        {"output": "private"},
    ):
        with pytest.raises(ValidationError):
            receipt_type.model_validate(wire | changes)
