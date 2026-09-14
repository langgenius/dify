import uuid
from unittest.mock import MagicMock, patch

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from tasks.remove_app_and_related_data_task import _delete_draft_variable_offload_data, delete_draft_variables_batch


def test_delete_draft_variable_offload_data_returns_storage_keys():
    """Verify that _delete_draft_variable_offload_data returns storage keys without calling storage.delete in session."""
    session = MagicMock()
    session.execute.side_effect = [
        # Result of query_sql: wdvf.id, uf.key, uf.id as upload_file_id
        [
            ("wdvf-1", "storage_key_1.bin", "uf-1"),
            ("wdvf-2", "storage_key_2.bin", "uf-2"),
        ],
        # Result of delete upload_files
        None,
        # Result of delete workflow_draft_variable_files
        None,
    ]

    storage_keys = _delete_draft_variable_offload_data(session, ["wdvf-1", "wdvf-2"])
    assert storage_keys == ["storage_key_1.bin", "storage_key_2.bin"]
    assert session.execute.call_count == 3


def test_delete_draft_variables_batch_deletes_storage_files_after_commit():
    """Verify that storage deletions are executed and counted."""
    app_id = str(uuid.uuid4())
    mock_storage = MagicMock()

    with (
        patch("tasks.remove_app_and_related_data_task.session_factory") as mock_session_factory,
        patch("extensions.ext_storage.storage", mock_storage),
        patch("tasks.remove_app_and_related_data_task._delete_draft_variable_offload_data") as mock_offload_del,
    ):
        mock_session = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value = mock_session
        mock_session.begin.return_value.__enter__.return_value = None

        # First iteration returns 1 row with a file_id, second iteration returns empty rows to break loop
        mock_cursor_result = MagicMock()
        mock_cursor_result.rowcount = 1

        mock_session.execute.side_effect = [
            [("var-1", "file-1")],  # select query batch 1
            mock_cursor_result,     # delete draft variables batch 1
            [],                     # select query batch 2 (empty, break)
        ]
        mock_offload_del.return_value = ["storage_file_1.png"]

        total_deleted = delete_draft_variables_batch(app_id=app_id, batch_size=10)

        assert total_deleted == 1
        mock_offload_del.assert_called_once_with(mock_session, ["file-1"])
        mock_storage.delete.assert_called_once_with("storage_file_1.png")
