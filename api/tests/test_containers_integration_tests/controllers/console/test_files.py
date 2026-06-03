"""Integration tests for console file endpoints."""

from __future__ import annotations

from io import BytesIO

from flask.testing import FlaskClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from models.model import UploadFile
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)


def test_file_upload_config_returns_console_limits(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    """Exercise the authenticated upload-config route and response contract."""
    account, _tenant = create_console_account_and_tenant(db_session_with_containers)
    headers = authenticate_console_client(test_client_with_containers, account)

    response = test_client_with_containers.get(
        "/console/api/files/upload",
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json == {
        "file_size_limit": dify_config.UPLOAD_FILE_SIZE_LIMIT,
        "batch_count_limit": dify_config.UPLOAD_FILE_BATCH_LIMIT,
        "file_upload_limit": dify_config.BATCH_UPLOAD_LIMIT,
        "image_file_size_limit": dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT,
        "video_file_size_limit": dify_config.UPLOAD_VIDEO_FILE_SIZE_LIMIT,
        "audio_file_size_limit": dify_config.UPLOAD_AUDIO_FILE_SIZE_LIMIT,
        "workflow_file_upload_limit": dify_config.WORKFLOW_FILE_UPLOAD_LIMIT,
        "image_file_batch_limit": dify_config.IMAGE_FILE_BATCH_LIMIT,
        "single_chunk_attachment_limit": dify_config.SINGLE_CHUNK_ATTACHMENT_LIMIT,
        "attachment_image_file_size_limit": dify_config.ATTACHMENT_IMAGE_FILE_SIZE_LIMIT,
    }


def test_file_upload_persists_file_for_authenticated_current_user(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    """Exercise real upload behavior plus current-user and tenant propagation."""
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    account_id = account.id
    tenant_id = tenant.id
    headers = authenticate_console_client(test_client_with_containers, account)
    content = b"hello from console integration"

    response = test_client_with_containers.post(
        "/console/api/files/upload",
        headers=headers,
        data={"file": (BytesIO(content), "tenant-owned.txt")},
        content_type="multipart/form-data",
    )

    assert response.status_code == 201
    assert response.json is not None
    assert response.json["name"] == "tenant-owned.txt"
    assert response.json["size"] == len(content)
    assert response.json["extension"] == "txt"
    assert response.json["mime_type"] == "text/plain"
    assert response.json["created_by"] == account_id

    upload_file = db_session_with_containers.scalar(
        select(UploadFile).where(UploadFile.id == response.json["id"]).limit(1)
    )
    assert upload_file is not None
    assert upload_file.tenant_id == tenant_id
    assert upload_file.created_by == account_id
    assert upload_file.name == "tenant-owned.txt"
    assert upload_file.size == len(content)
    assert f"/{tenant_id}/" in upload_file.key


def test_file_upload_rejects_missing_file_after_authentication(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    """Exercise the route's validation path with a real authenticated account."""
    account, _tenant = create_console_account_and_tenant(db_session_with_containers)
    headers = authenticate_console_client(test_client_with_containers, account)

    response = test_client_with_containers.post(
        "/console/api/files/upload",
        headers=headers,
        data={},
        content_type="multipart/form-data",
    )

    assert response.status_code == 400
    assert response.json is not None
    assert response.json["code"] == "no_file_uploaded"
