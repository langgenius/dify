"""What `POST /apps/<app_id>/files` declares, and what it deliberately does not."""

from __future__ import annotations

from controllers.openapi.auth.requirements import RBACCheck
from controllers.openapi.files import AppFileUploadApi


def test_upload_declares_no_rbac_scene():
    """Spec 4.6: uploading an input file is not an app run, so it is not gated on
    the `app.test_and_run` scene — a subject that RBAC refuses that scene to can
    still upload. `files.upload-rbac_on_denied` pins that end to end in the
    allow/deny matrix; this pins the declaration that row depends on.
    """
    assert not any(isinstance(requirement, RBACCheck) for requirement in AppFileUploadApi.post.__spec__.requirements)


def test_transaction_boundary_matches_the_pre_migration_decorator():
    """`upload` carried no `@with_session`: `FileService` opens its own session off
    `db.engine` and commits there, so the router must not own the transaction. The
    allow/deny matrix cannot see this — it observes admission before the view body runs.
    """
    assert AppFileUploadApi.post.__spec__.write is False
