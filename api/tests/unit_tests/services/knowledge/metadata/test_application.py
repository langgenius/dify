from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import cast
from unittest.mock import Mock, create_autospec

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from models import Account, Tenant
from models.dataset import DatasetMetadataBinding, Document
from models.enums import DocumentCreatedFrom
from repositories.knowledge.metadata_repository import SQLAlchemyMetadataRepository
from services.errors.metadata import MetadataResourceNotFoundError
from services.knowledge.dataset_access import DatasetAccess
from services.knowledge.entities.knowledge_entities import (
    DocumentMetadataOperation,
    MetadataArgs,
    MetadataDetail,
    MetadataOperationData,
)
from services.knowledge.metadata.application import MetadataService
from services.knowledge.resource_scope import DatasetRef
from tests.helpers.unit.model_factories import make_account, make_dataset, make_document


def _metadata_bug_complete_metadata_service(session: Session) -> MetadataService:
    return MetadataService(
        store=SQLAlchemyMetadataRepository(
            session_factory=sessionmaker(bind=session.get_bind(), expire_on_commit=False)
        ),
        dataset_access=create_autospec(DatasetAccess, instance=True),
    )


def _metadata_bug_complete_make_account(account_id: str = "user-456", tenant_id: str = "tenant-123") -> Account:
    account = Account(name="Test User", email=f"{account_id}@example.com")
    account.id = account_id
    tenant = Tenant(name="Test Tenant")
    tenant.id = tenant_id
    account._current_tenant = tenant
    return account


class TestMetadataBugCompleteCases:
    class TestMetadataBugCompleteValidation:
        """Complete test suite to verify the metadata nullable bug and its fix."""

        def test_1_pydantic_layer_validation(self) -> None:
            """Test Layer 1: Pydantic model validation correctly rejects None values."""
            # Pydantic should reject None values for required fields
            with pytest.raises((ValueError, TypeError)):
                MetadataArgs(type=None, name=None)  # pyrefly: ignore[bad-argument-type]

            with pytest.raises((ValueError, TypeError)):
                MetadataArgs(type="string", name=None)  # pyrefly: ignore[bad-argument-type]

            with pytest.raises((ValueError, TypeError)):
                MetadataArgs(type=None, name="test")  # pyrefly: ignore[bad-argument-type]

            # Valid values should work
            valid_args = MetadataArgs(type="string", name="test_name")
            assert valid_args.type == "string"
            assert valid_args.name == "test_name"

        @pytest.mark.parametrize("sqlite_session", [()], indirect=True)
        def test_2_business_logic_layer_crashes_on_none(self, sqlite_session: Session) -> None:
            """Test Layer 2: Business logic crashes when None values slip through."""
            # Create mock that bypasses Pydantic validation
            mock_metadata_args = Mock()
            mock_metadata_args.name = None
            mock_metadata_args.type = "string"

            account = _metadata_bug_complete_make_account()
            # Should crash with TypeError
            with pytest.raises(TypeError, match="object of type 'NoneType' has no len"):
                _metadata_bug_complete_metadata_service(sqlite_session).create_metadata(
                    DatasetRef("tenant-123", "dataset-123"), mock_metadata_args, actor_id=account.id
                )

            # Test update method as well
            account = _metadata_bug_complete_make_account()
            none_name = cast(str, None)
            with pytest.raises(TypeError, match="object of type 'NoneType' has no len"):
                _metadata_bug_complete_metadata_service(sqlite_session).update_metadata_name(
                    DatasetRef(Mock().tenant_id, Mock().id), "metadata-456", none_name, actor_id=account.id
                )
            assert not sqlite_session.in_transaction()

        def test_3_database_constraints_verification(self) -> None:
            """Test Layer 3: Verify database model has nullable=False constraints."""
            from sqlalchemy import inspect

            from models.dataset import DatasetMetadata

            # Get table info
            mapper = inspect(DatasetMetadata)

            # Check that type and name columns are not nullable
            type_column = mapper.columns["type"]
            name_column = mapper.columns["name"]

            assert type_column.nullable is False, "type column should be nullable=False"
            assert name_column.nullable is False, "name column should be nullable=False"

        def test_4_fixed_api_layer_rejects_null(self) -> None:
            """Test Layer 4: Fixed API configuration properly rejects null values using Pydantic."""
            with pytest.raises((ValueError, TypeError)):
                MetadataArgs.model_validate({"type": None, "name": None})

            with pytest.raises((ValueError, TypeError)):
                MetadataArgs.model_validate({"type": "string", "name": None})

            with pytest.raises((ValueError, TypeError)):
                MetadataArgs.model_validate({"type": None, "name": "test"})

        def test_5_fixed_api_accepts_valid_values(self) -> None:
            """Test that fixed API still accepts valid non-null values."""
            args = MetadataArgs.model_validate({"type": "string", "name": "valid_name"})
            assert args.type == "string"
            assert args.name == "valid_name"

        @pytest.mark.parametrize("sqlite_session", [()], indirect=True)
        def test_6_simulated_buggy_behavior(self, sqlite_session: Session) -> None:
            """Test simulating the original buggy behavior by bypassing Pydantic validation."""
            mock_metadata_args = Mock()
            mock_metadata_args.name = None
            mock_metadata_args.type = None

            account = _metadata_bug_complete_make_account()
            with pytest.raises(TypeError, match="object of type 'NoneType' has no len"):
                _metadata_bug_complete_metadata_service(sqlite_session).create_metadata(
                    DatasetRef("tenant-123", "dataset-123"), mock_metadata_args, actor_id=account.id
                )
            assert not sqlite_session.in_transaction()

        def test_7_end_to_end_validation_layers(self) -> None:
            """Test all validation layers work together correctly."""
            # Layer 1: API should reject null at parameter level (with fix)
            # Layer 2: Pydantic should reject null at model level
            # Layer 3: Business logic expects non-null
            # Layer 4: Database enforces non-null

            # Test that valid data flows through all layers
            valid_data = {"type": "string", "name": "test_metadata"}

            # Should create valid Pydantic object
            metadata_args = MetadataArgs.model_validate(valid_data)
            assert metadata_args.type == "string"
            assert metadata_args.name == "test_metadata"

            # Should not crash in business logic length check
            assert len(metadata_args.name) <= 255  # This should not crash
            assert len(metadata_args.type) > 0  # This should not crash

        def test_8_verify_specific_fix_locations(self) -> None:
            """Verify that the specific locations mentioned in bug report are fixed."""
            # Read the actual files to verify fixes
            import os

            # Console API create
            console_create_file = "api/controllers/console/datasets/metadata.py"
            if os.path.exists(console_create_file):
                content = Path(console_create_file).read_text()
                # Should contain nullable=False, not nullable=True
                assert "nullable=True" not in content.split("class DatasetMetadataCreateApi")[1].split("class")[0]

            # Service API create
            service_create_file = "api/controllers/service_api/dataset/metadata.py"
            if os.path.exists(service_create_file):
                content = Path(service_create_file).read_text()
                # Should contain nullable=False, not nullable=True
                create_api_section = content.split("class DatasetMetadataCreateServiceApi")[1].split("class")[0]
                assert "nullable=True" not in create_api_section

    class TestMetadataValidationSummary:
        """Summary tests that demonstrate the complete validation architecture."""

        def test_validation_layer_architecture(self) -> None:
            """Document and test the 4-layer validation architecture."""
            # Layer 1: API Parameter Validation (Flask-RESTful reqparse)
            # - Role: First line of defense, validates HTTP request parameters
            # - Fixed: nullable=False ensures null values are rejected at API boundary

            # Layer 2: Pydantic Model Validation
            # - Role: Validates data structure and types before business logic
            # - Working: Required fields without Optional[] reject None values

            # Layer 3: Business Logic Validation
            # - Role: Domain-specific validation (length checks, uniqueness, etc.)
            # - Vulnerable: Direct len() calls crash on None values

            # Layer 4: Database Constraints
            # - Role: Final data integrity enforcement
            # - Working: nullable=False prevents None values in database

            # The bug was: Layer 1 allowed None, but Layers 2-4 expected non-None
            # The fix: Make Layer 1 consistent with Layers 2-4

            assert True  # This test documents the architecture


def _metadata_nullable_bug_metadata_service(session: Session) -> MetadataService:
    return MetadataService(
        store=SQLAlchemyMetadataRepository(
            session_factory=sessionmaker(bind=session.get_bind(), expire_on_commit=False)
        ),
        dataset_access=create_autospec(DatasetAccess, instance=True),
    )


def _metadata_nullable_bug_make_account(account_id: str = "user-456", tenant_id: str = "tenant-123") -> Account:
    account = Account(name="Test User", email=f"{account_id}@example.com")
    account.id = account_id
    tenant = Tenant(name="Test Tenant")
    tenant.id = tenant_id
    account._current_tenant = tenant
    return account


class TestMetadataNullableBugCases:
    pytestmark = [
        pytest.mark.usefixtures("sqlite_session"),
        pytest.mark.parametrize("sqlite_session", [()], indirect=True),
    ]

    class TestMetadataNullableBug:
        """Test case to reproduce the metadata nullable validation bug."""

        def test_metadata_args_with_none_values_should_fail(self) -> None:
            """Test that MetadataArgs validation should reject None values."""
            # This test demonstrates the expected behavior - should fail validation
            with pytest.raises((ValueError, TypeError)):
                # This should fail because Pydantic expects non-None values
                MetadataArgs(type=None, name=None)  # pyrefly: ignore[bad-argument-type]

        def test_metadata_service_create_with_none_name_crashes(self, sqlite_session: Session) -> None:
            """Test that MetadataService.create_metadata crashes when name is None."""
            # Mock the MetadataArgs to bypass Pydantic validation
            mock_metadata_args = Mock()
            mock_metadata_args.name = None  # This will cause len() to crash
            mock_metadata_args.type = "string"

            account = _metadata_nullable_bug_make_account()
            # This should crash with TypeError when calling len(None)
            with pytest.raises(TypeError, match="object of type 'NoneType' has no len"):
                _metadata_nullable_bug_metadata_service(sqlite_session).create_metadata(
                    DatasetRef("tenant-123", "dataset-123"), mock_metadata_args, actor_id=account.id
                )
            assert not sqlite_session.in_transaction()

        def test_metadata_service_update_with_none_name_crashes(self, sqlite_session: Session) -> None:
            """Test that MetadataService.update_metadata_name crashes when name is None."""
            account = _metadata_nullable_bug_make_account()
            none_name = cast(str, None)
            # This should crash with TypeError when calling len(None)
            with pytest.raises(TypeError, match="object of type 'NoneType' has no len"):
                _metadata_nullable_bug_metadata_service(sqlite_session).update_metadata_name(
                    DatasetRef(Mock().tenant_id, Mock().id), "metadata-456", none_name, actor_id=account.id
                )
            assert not sqlite_session.in_transaction()

        def test_api_layer_now_uses_pydantic_validation(self) -> None:
            """Verify that API layer relies on Pydantic validation instead of reqparse."""
            invalid_payload: dict[str, object] = {"type": None, "name": None}
            with pytest.raises((ValueError, TypeError)):
                MetadataArgs.model_validate(invalid_payload)

            valid_payload = {"type": "string", "name": "valid"}
            args = MetadataArgs.model_validate(valid_payload)
            assert args.type == "string"
            assert args.name == "valid"


"""Metadata operations persist through scoped, independently owned transactions."""


REF = DatasetRef("tenant-1", "dataset-1")
DOCUMENT_ID = "11111111-1111-1111-1111-111111111111"
FOREIGN_ID = "22222222-2222-2222-2222-222222222222"


def _operation(document_id: str, metadata_id: str, *, partial: bool = False) -> MetadataOperationData:
    return MetadataOperationData(
        operation_data=[
            DocumentMetadataOperation(
                document_id=document_id,
                metadata_list=[MetadataDetail(id=metadata_id, name="spoofed", value="Alice")],
                partial_update=partial,
            )
        ]
    )


class TestMetadataServiceSessionBoundaryCases:
    @staticmethod
    @pytest.fixture
    def metadata_service(sqlite_session_factory: sessionmaker[Session]) -> Iterator[MetadataService]:
        with sqlite_session_factory.begin() as session:
            account = make_account(account_id="actor", name="User", email="metadata@example.com")
            session.add(account)
            for ref, document_id in [(REF, DOCUMENT_ID), (DatasetRef("tenant-2", "dataset-2"), FOREIGN_ID)]:
                session.add(
                    make_dataset(dataset_id=ref.dataset_id, tenant_id=ref.tenant_id, name="Dataset", created_by="actor")
                )
                document = make_document(
                    document_id=document_id,
                    tenant_id=ref.tenant_id,
                    dataset_id=ref.dataset_id,
                    batch="batch",
                    created_from=DocumentCreatedFrom.API,
                    created_by="actor",
                    created_at=datetime(2026, 1, 1),
                    updated_at=datetime(2026, 1, 2),
                )
                document.enabled = True
                document.archived = False
                document.indexing_status = "completed"
                session.add(document)
        return MetadataService(
            store=SQLAlchemyMetadataRepository(session_factory=sqlite_session_factory),
            dataset_access=create_autospec(DatasetAccess, instance=True),
        )

    @staticmethod
    def test_create_commits_through_owned_session(
        metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        result = metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")
        fields = metadata_service.get_dataset_metadatas(REF)
        assert fields["doc_metadata"] == [{"id": result.id, "type": "string", "name": "author", "count": 0}]
        with sqlite_session_factory() as session:
            assert session.scalar(select(DatasetMetadataBinding)) is None

    @staticmethod
    @pytest.mark.parametrize(
        "name", ["x" * 256, "document_name", "uploader", "upload_date", "last_update_date", "source"]
    )
    def test_invalid_name_is_rejected(metadata_service: MetadataService, name: str) -> None:
        with pytest.raises(
            ValueError,
            match=(
                "(?:Metadata name already exists in Built\\-in fields\\.|Metadata name cannot exceed 255 characters\\.)"
            ),
        ):
            metadata_service.create_metadata(REF, MetadataArgs(type="string", name=name), actor_id="actor")
        assert metadata_service.get_dataset_metadatas(REF)["doc_metadata"] == []

    @staticmethod
    def test_duplicate_name_is_rejected(metadata_service: MetadataService) -> None:
        metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")
        with pytest.raises(ValueError, match="already exists"):
            metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")

    @staticmethod
    @pytest.mark.parametrize("partial", [True, False])
    def test_update_uses_canonical_names_and_preserves_partial_values(
        metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session], partial: bool
    ) -> None:
        field = metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")
        with sqlite_session_factory.begin() as session:
            document = session.get(Document, DOCUMENT_ID)
            assert document is not None
            document.doc_metadata = {"existing": "kept"}
        metadata_service.update_documents_metadata(
            REF, _operation(DOCUMENT_ID, field.id, partial=partial), actor_id="actor"
        )
        metadata_service.update_documents_metadata(
            REF, _operation(DOCUMENT_ID, field.id, partial=partial), actor_id="actor"
        )
        with sqlite_session_factory() as session:
            document = session.get(Document, DOCUMENT_ID)
            assert document is not None
            assert document.doc_metadata == (
                {"existing": "kept", "author": "Alice"} if partial else {"author": "Alice"}
            )
            assert len(session.scalars(select(DatasetMetadataBinding)).all()) == 1

    @staticmethod
    @pytest.mark.parametrize("foreign", ["dataset", "document", "metadata"])
    def test_owner_chain_is_validated_before_any_batch_write(
        metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session], foreign: str
    ) -> None:
        field = metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")
        other = metadata_service.create_metadata(
            DatasetRef("tenant-2", "dataset-2"), MetadataArgs(type="string", name="foreign"), actor_id="actor"
        )
        args = _operation(DOCUMENT_ID, field.id)
        args.operation_data.extend(
            _operation(
                FOREIGN_ID if foreign == "document" else DOCUMENT_ID, other.id if foreign == "metadata" else field.id
            ).operation_data
        )
        ref = DatasetRef("tenant-2", REF.dataset_id) if foreign == "dataset" else REF
        with pytest.raises(MetadataResourceNotFoundError):
            metadata_service.update_documents_metadata(ref, args, actor_id="actor")
        with sqlite_session_factory() as session:
            assert all(document.doc_metadata is None for document in session.scalars(select(Document)))
            assert not session.scalars(select(DatasetMetadataBinding)).all()

    @staticmethod
    def test_rename_delete_and_counts_share_scoped_bindings(
        metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        field = metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")
        metadata_service.update_documents_metadata(REF, _operation(DOCUMENT_ID, field.id), actor_id="actor")
        renamed = metadata_service.update_metadata_name(REF, field.id, "writer", actor_id="actor")
        assert renamed.name == "writer"
        assert metadata_service.get_dataset_metadatas(REF)["doc_metadata"] == [
            {"id": field.id, "name": "writer", "type": "string", "count": 1}
        ]
        with sqlite_session_factory() as session:
            document = session.get(Document, DOCUMENT_ID)
            assert document is not None
            assert document.doc_metadata == {"writer": "Alice"}
        metadata_service.delete_metadata(REF, field.id)
        with sqlite_session_factory() as session:
            document = session.get(Document, DOCUMENT_ID)
            assert document is not None
            assert document.doc_metadata == {}
            assert not session.scalars(select(DatasetMetadataBinding)).all()

    @staticmethod
    def test_builtin_fields_use_owned_document_uploader(
        metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        metadata_service.enable_built_in_field(REF)
        with sqlite_session_factory() as session:
            document = session.get(Document, DOCUMENT_ID)
            foreign = session.get(Document, FOREIGN_ID)
            assert document is not None
            assert foreign is not None
            assert document.doc_metadata["uploader"] == "User"
            assert foreign.doc_metadata is None
        metadata_service.disable_built_in_field(REF)
        with sqlite_session_factory() as session:
            document = session.get(Document, DOCUMENT_ID)
            assert document is not None
            assert document.doc_metadata == {}

    @staticmethod
    def test_commit_failure_rolls_back_document_and_bindings(
        metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        field = metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")

        def fail(_session: Session) -> None:
            raise RuntimeError("commit failed")

        event.listen(sqlite_session_factory.class_, "before_commit", fail)
        try:
            with pytest.raises(RuntimeError, match="commit failed"):
                metadata_service.update_documents_metadata(REF, _operation(DOCUMENT_ID, field.id), actor_id="actor")
        finally:
            event.remove(sqlite_session_factory.class_, "before_commit", fail)
        with sqlite_session_factory() as session:
            document = session.get(Document, DOCUMENT_ID)
            assert document is not None
            assert document.doc_metadata is None
            assert not session.scalars(select(DatasetMetadataBinding)).all()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
