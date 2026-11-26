"""Validation of the Console config asset request contract."""

import pytest
from pydantic import ValidationError

from controllers.console.app.agent_config_inspector import AgentConfigFilesUploadPayload


@pytest.mark.parametrize("upload_ids", [[], ["invalid-uuid"]])
def test_batch_file_upload_payload_requires_nonempty_uuid_list(upload_ids: list[str]) -> None:
    """Reject requests without a nonempty list of valid file IDs."""
    with pytest.raises(ValidationError):
        AgentConfigFilesUploadPayload.model_validate({"upload_file_ids": upload_ids})
