"""
Integration tests for Conversation.inputs and Message.inputs tenant resolution.

Migrated from unit_tests/models/test_model.py, replacing db.session.scalar monkeypatching
with a real App in PostgreSQL so the _resolve_app_tenant_id lookup executes against the DB.
"""

from collections.abc import Generator
from unittest.mock import patch
from uuid import uuid4

import pytest
from graphon.file import FILE_MODEL_IDENTITY, FileTransferMethod
from sqlalchemy.orm import Session

from core.workflow.file_reference import build_file_reference
from models.model import App, AppMode, Conversation, Message


def _build_local_file_mapping(record_id: str, *, tenant_id: str | None = None) -> dict:
    mapping: dict = {
        "dify_model_identity": FILE_MODEL_IDENTITY,
        "transfer_method": FileTransferMethod.LOCAL_FILE,
        "reference": build_file_reference(record_id=record_id),
        "type": "document",
        "filename": "example.txt",
        "extension": ".txt",
        "mime_type": "text/plain",
        "size": 1,
    }
    if tenant_id is not None:
        mapping["tenant_id"] = tenant_id
    return mapping


class TestConversationMessageInputsTenantResolution:
    """Integration tests for Conversation/Message.inputs tenant resolution via real DB lookup."""

    @pytest.fixture(autouse=True)
    def _auto_rollback(self, db_session_with_containers: Session) -> Generator[None, None, None]:
        """Automatically rollback session changes after each test."""
        yield
        db_session_with_containers.rollback()

    def _create_app(self, db_session: Session) -> App:
        tenant_id = str(uuid4())
        app = App(
            tenant_id=tenant_id,
            name=f"App {uuid4()}",
            mode=AppMode.CHAT,
            enable_site=False,
            enable_api=True,
            is_demo=False,
            is_public=False,
            is_universal=False,
            created_by=str(uuid4()),
            updated_by=str(uuid4()),
        )
        db_session.add(app)
        db_session.flush()
        return app

    @pytest.mark.parametrize("owner_cls", [Conversation, Message])
    def test_inputs_resolves_tenant_via_db_for_local_file(
        self,
        db_session_with_containers: Session,
        owner_cls: type,
    ) -> None:
        """Inputs resolves tenant_id from real App row when file mapping has no tenant_id."""
        app = self._create_app(db_session_with_containers)
        build_calls: list[tuple[dict, str]] = []

        def fake_build_from_mapping(
            *, mapping, tenant_id, config=None, strict_type_validation=False, access_controller
        ):
            build_calls.append((dict(mapping), tenant_id))
            return {"tenant_id": tenant_id, "upload_file_id": mapping.get("upload_file_id")}

        with patch("factories.file_factory.build_from_mapping", fake_build_from_mapping):
            owner = owner_cls(app_id=app.id)
            owner.inputs = {"file": _build_local_file_mapping("upload-1")}

            restored_inputs = owner.inputs

        # The tenant_id should come from the real App row in the DB
        assert restored_inputs["file"] == {"tenant_id": app.tenant_id, "upload_file_id": "upload-1"}
        assert len(build_calls) == 1
        assert build_calls[0][1] == app.tenant_id

    @pytest.mark.parametrize("owner_cls", [Conversation, Message])
    def test_inputs_uses_serialized_tenant_id_skipping_db_lookup(
        self,
        db_session_with_containers: Session,
        owner_cls: type,
    ) -> None:
        """Inputs uses tenant_id from the file mapping payload without hitting the DB."""
        app = self._create_app(db_session_with_containers)
        payload_tenant_id = "tenant-from-payload"
        build_calls: list[tuple[dict, str]] = []

        def fake_build_from_mapping(
            *, mapping, tenant_id, config=None, strict_type_validation=False, access_controller
        ):
            build_calls.append((dict(mapping), tenant_id))
            return {"tenant_id": tenant_id, "upload_file_id": mapping.get("upload_file_id")}

        with patch("factories.file_factory.build_from_mapping", fake_build_from_mapping):
            owner = owner_cls(app_id=app.id)
            owner.inputs = {"file": _build_local_file_mapping("upload-1", tenant_id=payload_tenant_id)}

            restored_inputs = owner.inputs

        assert restored_inputs["file"] == {"tenant_id": payload_tenant_id, "upload_file_id": "upload-1"}
        assert len(build_calls) == 1
        assert build_calls[0][1] == payload_tenant_id

    @pytest.mark.parametrize("owner_cls", [Conversation, Message])
    def test_inputs_resolves_tenant_for_file_list(
        self,
        db_session_with_containers: Session,
        owner_cls: type,
    ) -> None:
        """Inputs resolves tenant_id for a list of file mappings."""
        app = self._create_app(db_session_with_containers)
        build_calls: list[tuple[dict, str]] = []

        def fake_build_from_mapping(
            *, mapping, tenant_id, config=None, strict_type_validation=False, access_controller
        ):
            build_calls.append((dict(mapping), tenant_id))
            return {"tenant_id": tenant_id, "upload_file_id": mapping.get("upload_file_id")}

        with patch("factories.file_factory.build_from_mapping", fake_build_from_mapping):
            owner = owner_cls(app_id=app.id)
            owner.inputs = {
                "files": [
                    _build_local_file_mapping("upload-1"),
                    _build_local_file_mapping("upload-2"),
                ]
            }

            restored_inputs = owner.inputs

        assert len(build_calls) == 2
        assert all(call[1] == app.tenant_id for call in build_calls)
        assert restored_inputs["files"] == [
            {"tenant_id": app.tenant_id, "upload_file_id": "upload-1"},
            {"tenant_id": app.tenant_id, "upload_file_id": "upload-2"},
        ]
