"""Regression coverage for #41735.

The pre-fix code in ``DocumentService.save_document_with_dataset_id``
read ``UploadFile`` rows inside a single session that had its
``REPEATABLE READ`` snapshot pinned by an earlier ``Dataset`` SELECT.
When ``FileService.upload_text`` / ``upload_file`` committed the
``upload_files`` row in a SEPARATE session, the row was invisible to
*this* session until the snapshot was refreshed, and
``save_document_with_dataset_id`` reported ``One or more files not
found.`` even though the row was committed (verified via a second
session).

The fix forces ``session.commit()`` immediately before the
``UploadFile`` lookup so the next SELECT starts a fresh snapshot.
This file pins that contract by reading the function source and
asserting the structural invariant directly.
"""

from __future__ import annotations

import inspect

from services.dataset_service import DocumentService


def test_session_committed_before_upload_file_lookup() -> None:
    """#41735: ``session.commit()`` must run BEFORE the ``UploadFile``
    SELECT so the SELECT sees rows committed by ``FileService.upload_text``
    on a different session. MySQL REPEATABLE READ keeps the original
    snapshot for the rest of the transaction; the commit ends it so the
    next SELECT starts a fresh transaction with a new snapshot.
    PostgreSQL's default READ COMMITTED rebuilds the read view per
    statement so the extra commit is a no-op there.

    Read the function source and assert that ``session.commit()`` is
    called BEFORE the ``UploadFile`` SELECT — the same structural
    invariant the reproduction in the issue depends on, without needing
    a live MySQL database.
    """
    source_lines = inspect.getsource(DocumentService.save_document_with_dataset_id).splitlines()

    upload_select_line = next(
        (i for i, line in enumerate(source_lines) if "select(UploadFile)" in line),
        None,
    )
    assert upload_select_line is not None, "save_document_with_dataset_id must contain a select(UploadFile) call"

    # Find every ``session.commit()`` call, then keep the last one
    # whose line number is BEFORE the UploadFile SELECT. If the fix is
    # in place, that commit is the snapshot refresh.
    last_commit_before_upload = -1
    for i, line in enumerate(source_lines):
        if i >= upload_select_line:
            break
        if "session.commit()" in line:
            last_commit_before_upload = i

    assert last_commit_before_upload >= 0, (
        "save_document_with_dataset_id must call session.commit() at least once before the UploadFile SELECT"
    )

    # The fix is a focused call: one extra ``session.commit()`` between
    # the (already-existing) ``DocumentService.check_doc_form`` call and
    # the ``select(UploadFile)`` call. Pin that there's a comment
    # referencing #41735 right above the new commit so a future edit
    # doesn't accidentally delete the snapshot refresh without
    # understanding why it's there.
    assert "#41735" in "\n".join(source_lines), (
        "The fix's invariant comment referencing issue #41735 must be present in save_document_with_dataset_id"
    )
