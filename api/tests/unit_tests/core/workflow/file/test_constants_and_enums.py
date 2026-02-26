from __future__ import annotations

import pytest

from core.workflow.file.constants import FILE_MODEL_IDENTITY, maybe_file_object
from core.workflow.file.enums import FileBelongsTo, FileTransferMethod, FileType


def test_maybe_file_object_checks_marker_key() -> None:
    assert maybe_file_object({"dify_model_identity": FILE_MODEL_IDENTITY}) is True
    assert maybe_file_object({"dify_model_identity": "other"}) is False
    assert maybe_file_object("not-a-dict") is False


def test_enum_value_of_helpers_return_enum_members_or_raise() -> None:
    assert FileType.value_of("image") == FileType.IMAGE
    assert FileTransferMethod.value_of("tool_file") == FileTransferMethod.TOOL_FILE
    assert FileBelongsTo.value_of("assistant") == FileBelongsTo.ASSISTANT

    with pytest.raises(ValueError, match="No matching enum found"):
        FileType.value_of("unknown")
    with pytest.raises(ValueError, match="No matching enum found"):
        FileTransferMethod.value_of("unknown")
    with pytest.raises(ValueError, match="No matching enum found"):
        FileBelongsTo.value_of("unknown")
