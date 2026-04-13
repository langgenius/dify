"""
Comprehensive unit tests for WorkflowRunRestore service.

This file provides complete test coverage for all WorkflowRunRestore methods.
Tests are organized by functionality and include edge cases, error handling,
and both positive and negative test scenarios.
"""

import io
import json
import zipfile
from datetime import datetime
from unittest.mock import Mock, create_autospec, patch

import pytest
from pydantic import ValidationError
from sqlalchemy import Column, Integer, MetaData, String, Table

from libs.archive_storage import ArchiveStorageNotConfiguredError
from models.trigger import WorkflowTriggerLog
from models.workflow import (
    WorkflowAppLog,
    WorkflowArchiveLog,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowPause,
    WorkflowPauseReason,
    WorkflowRun,
)
from services.retention.workflow_run.restore_archived_workflow_run import (
    SCHEMA_MAPPERS,
    TABLE_MODELS,
    RestoreResult,
    WorkflowRunRestore,
)


class WorkflowRunRestoreTestDataFactory:
    """
    Factory for creating test data and mock objects.

    Provides reusable methods to create consistent mock objects for testing
    workflow run restore operations.
    """

    @staticmethod
    def create_workflow_run_mock(
        run_id: str = "run-123",
        tenant_id: str = "tenant-123",
        app_id: str = "app-123",
        created_at: datetime | None = None,
        **kwargs,
    ) -> Mock:
        """
        Create a mock WorkflowRun object.

        Args:
            run_id: Unique identifier for the workflow run
            tenant_id: Tenant/workspace identifier
            app_id: Application identifier
            created_at: Creation timestamp
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock WorkflowRun object with specified attributes
        """
        run = create_autospec(WorkflowRun, instance=True)
        run.id = run_id
        run.tenant_id = tenant_id
        run.app_id = app_id
        run.created_at = created_at or datetime(2024, 1, 1, 12, 0, 0)
        for key, value in kwargs.items():
            setattr(run, key, value)
        return run

    @staticmethod
    def create_workflow_archive_log_mock(
        run_id: str = "run-123",
        tenant_id: str = "tenant-123",
        app_id: str = "app-123",
        created_at: datetime | None = None,
        **kwargs,
    ) -> Mock:
        """
        Create a mock WorkflowArchiveLog object.

        Args:
            run_id: Unique identifier for the workflow run
            tenant_id: Tenant/workspace identifier
            app_id: Application identifier
            created_at: Creation timestamp
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock WorkflowArchiveLog object with specified attributes
        """
        archive_log = create_autospec(WorkflowArchiveLog, instance=True)
        archive_log.workflow_run_id = run_id
        archive_log.tenant_id = tenant_id
        archive_log.app_id = app_id
        archive_log.run_created_at = created_at or datetime(2024, 1, 1, 12, 0, 0)
        for key, value in kwargs.items():
            setattr(archive_log, key, value)
        return archive_log

    @staticmethod
    def create_archive_zip_mock(
        manifest: dict | None = None,
        tables_data: dict[str, list[dict]] | None = None,
    ) -> bytes:
        """
        Create a mock archive zip file in memory.

        Args:
            manifest: Archive manifest data
            tables_data: Dictionary mapping table names to list of records

        Returns:
            Bytes representing the zip file
        """
        if manifest is None:
            manifest = {
                "schema_version": "1.0",
                "tables": {
                    "workflow_runs": {"row_count": 1},
                    "workflow_app_logs": {"row_count": 2},
                },
            }

        if tables_data is None:
            tables_data = {
                "workflow_runs": [
                    {
                        "id": "run-123",
                        "tenant_id": "tenant-123",
                        "app_id": "app-123",
                        "workflow_id": "workflow-123",
                        "type": "workflow",
                        "triggered_from": "app",
                        "version": "1",
                        "status": "succeeded",
                        "created_by_role": "account",
                        "created_by": "user-123",
                    }
                ],
                "workflow_app_logs": [
                    {
                        "id": "log-1",
                        "tenant_id": "tenant-123",
                        "app_id": "app-123",
                        "workflow_id": "workflow-123",
                        "workflow_run_id": "run-123",
                        "created_from": "app",
                        "created_by_role": "account",
                        "created_by": "user-123",
                    },
                    {
                        "id": "log-2",
                        "tenant_id": "tenant-123",
                        "app_id": "app-123",
                        "workflow_id": "workflow-123",
                        "workflow_run_id": "run-123",
                        "created_from": "app",
                        "created_by_role": "account",
                        "created_by": "user-123",
                    },
                ],
            }

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
            zip_file.writestr("manifest.json", json.dumps(manifest))
            for table_name, records in tables_data.items():
                jsonl_data = "\n".join(json.dumps(record) for record in records)
                zip_file.writestr(f"{table_name}.jsonl", jsonl_data)

        zip_buffer.seek(0)
        return zip_buffer.getvalue()


# ---------------------------------------------------------------------------
# Test WorkflowRunRestore Initialization
# ---------------------------------------------------------------------------


class TestWorkflowRunRestoreInit:
    """Tests for WorkflowRunRestore.__init__ method."""

    def test_default_initialization(self):
        """Service should initialize with default values."""
        restore = WorkflowRunRestore()
        assert restore.dry_run is False
        assert restore.workers == 1
        assert restore.workflow_run_repo is None

    def test_dry_run_initialization(self):
        """Service should respect dry_run flag."""
        restore = WorkflowRunRestore(dry_run=True)
        assert restore.dry_run is True
        assert restore.workers == 1

    def test_custom_workers_initialization(self):
        """Service should accept custom workers count."""
        restore = WorkflowRunRestore(workers=5)
        assert restore.workers == 5

    def test_invalid_workers_raises_error(self):
        """Service should raise ValueError for workers less than 1."""
        with pytest.raises(ValueError, match="workers must be at least 1"):
            WorkflowRunRestore(workers=0)

    def test_negative_workers_raises_error(self):
        """Service should raise ValueError for negative workers."""
        with pytest.raises(ValueError, match="workers must be at least 1"):
            WorkflowRunRestore(workers=-1)


# ---------------------------------------------------------------------------
# Test _get_workflow_run_repo Method
# ---------------------------------------------------------------------------


class TestGetWorkflowRunRepo:
    """Tests for WorkflowRunRestore._get_workflow_run_repo method."""

    @patch("services.retention.workflow_run.restore_archived_workflow_run.DifyAPIRepositoryFactory")
    @patch("services.retention.workflow_run.restore_archived_workflow_run.sessionmaker")
    @patch("services.retention.workflow_run.restore_archived_workflow_run.db")
    def test_first_call_creates_repo(self, mock_db, mock_sessionmaker, mock_factory):
        """First call should create and cache repository."""
        restore = WorkflowRunRestore()

        mock_session = Mock()
        mock_sessionmaker.return_value = mock_session
        mock_repo = Mock()
        mock_factory.create_api_workflow_run_repository.return_value = mock_repo

        result = restore._get_workflow_run_repo()

        assert result is mock_repo
        assert restore.workflow_run_repo is mock_repo
        mock_sessionmaker.assert_called_once_with(bind=mock_db.engine, expire_on_commit=False)
        mock_factory.create_api_workflow_run_repository.assert_called_once_with(mock_session)

    def test_cached_repo_returned(self):
        """Subsequent calls should return cached repository."""
        restore = WorkflowRunRestore()
        mock_repo = Mock()
        restore.workflow_run_repo = mock_repo

        result = restore._get_workflow_run_repo()

        assert result is mock_repo


# ---------------------------------------------------------------------------
# Test _load_manifest_from_zip Method
# ---------------------------------------------------------------------------


class TestLoadManifestFromZip:
    """Tests for WorkflowRunRestore._load_manifest_from_zip method."""

    def test_load_valid_manifest(self):
        """Should load manifest from valid zip."""
        manifest_data = {"schema_version": "1.0", "tables": {}}
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as zip_file:
            zip_file.writestr("manifest.json", json.dumps(manifest_data))
        zip_buffer.seek(0)

        with zipfile.ZipFile(zip_buffer, "r") as archive:
            result = WorkflowRunRestore._load_manifest_from_zip(archive)

        assert result == manifest_data

    def test_missing_manifest_raises_error(self):
        """Should raise ValueError when manifest.json is missing."""
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as zip_file:
            zip_file.writestr("other.txt", "data")
        zip_buffer.seek(0)

        with zipfile.ZipFile(zip_buffer, "r") as archive:
            with pytest.raises(ValueError, match="manifest.json missing from archive bundle"):
                WorkflowRunRestore._load_manifest_from_zip(archive)

    def test_invalid_json_raises_error(self):
        """Should raise ValueError when manifest contains invalid JSON."""
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as zip_file:
            zip_file.writestr("manifest.json", "invalid json")
        zip_buffer.seek(0)

        with zipfile.ZipFile(zip_buffer, "r") as archive:
            with pytest.raises(ValidationError):
                WorkflowRunRestore._load_manifest_from_zip(archive)


# ---------------------------------------------------------------------------
# Test _get_schema_version Method
# ---------------------------------------------------------------------------


class TestGetSchemaVersion:
    """Tests for WorkflowRunRestore._get_schema_version method."""

    def test_valid_schema_version(self):
        """Should return valid schema version from manifest."""
        restore = WorkflowRunRestore()
        manifest = {"schema_version": "1.0"}
        result = restore._get_schema_version(manifest)
        assert result == "1.0"

    def test_missing_schema_version_defaults_to_1_0(self):
        """Should default to 1.0 when schema_version is missing."""
        restore = WorkflowRunRestore()
        manifest = {"tables": {}}

        with patch("services.retention.workflow_run.restore_archived_workflow_run.logger") as mock_logger:
            result = restore._get_schema_version(manifest)

        assert result == "1.0"
        mock_logger.warning.assert_called_once_with("Manifest missing schema_version; defaulting to 1.0")

    def test_unsupported_schema_version_raises_error(self):
        """Should raise ValueError for unsupported schema version."""
        restore = WorkflowRunRestore()
        manifest = {"schema_version": "2.0"}

        with pytest.raises(ValueError, match="Unsupported schema_version 2.0"):
            restore._get_schema_version(manifest)

    def test_numeric_schema_version_converted_to_string(self):
        """Should convert numeric schema version to string."""
        restore = WorkflowRunRestore()
        manifest = {"schema_version": 1}

        # This should raise ValueError because "1" is not in SCHEMA_MAPPERS (only "1.0" is)
        with pytest.raises(ValueError, match="Unsupported schema_version 1"):
            restore._get_schema_version(manifest)


# ---------------------------------------------------------------------------
# Test _apply_schema_mapping Method
# ---------------------------------------------------------------------------


class TestApplySchemaMapping:
    """Tests for WorkflowRunRestore._apply_schema_mapping method."""

    def test_no_mapping_returns_original(self):
        """Should return original record when no mapping exists."""
        restore = WorkflowRunRestore()
        record = {"id": "test", "name": "test"}
        result = restore._apply_schema_mapping("workflow_runs", "1.0", record)
        assert result == record

    def test_mapping_applied(self):
        """Should apply mapping when it exists."""
        restore = WorkflowRunRestore()

        def test_mapper(record):
            return {**record, "mapped": True}

        # Add test mapper to SCHEMA_MAPPERS
        original_mappers = SCHEMA_MAPPERS.copy()
        SCHEMA_MAPPERS["1.0"]["test_table"] = test_mapper

        try:
            record = {"id": "test"}
            result = restore._apply_schema_mapping("test_table", "1.0", record)
            assert result == {"id": "test", "mapped": True}
        finally:
            # Restore original mappers
            SCHEMA_MAPPERS.clear()
            SCHEMA_MAPPERS.update(original_mappers)


# ---------------------------------------------------------------------------
# Test _convert_datetime_fields Method
# ---------------------------------------------------------------------------


class TestConvertDatetimeFields:
    """Tests for WorkflowRunRestore._convert_datetime_fields method."""

    def test_iso_datetime_conversion(self):
        """Should convert ISO datetime strings to datetime objects."""
        restore = WorkflowRunRestore()

        record = {"created_at": "2024-01-01T12:00:00", "name": "test"}
        result = restore._convert_datetime_fields(record, WorkflowRun)

        assert isinstance(result["created_at"], datetime)
        assert result["created_at"].year == 2024
        assert result["name"] == "test"

    def test_invalid_datetime_ignored(self):
        """Should ignore invalid datetime strings."""
        restore = WorkflowRunRestore()

        record = {"created_at": "invalid-date", "name": "test"}
        result = restore._convert_datetime_fields(record, WorkflowRun)

        assert result["created_at"] == "invalid-date"
        assert result["name"] == "test"

    def test_non_datetime_columns_unchanged(self):
        """Should leave non-datetime columns unchanged."""
        restore = WorkflowRunRestore()

        record = {"id": "test", "tenant_id": "tenant-123"}
        result = restore._convert_datetime_fields(record, WorkflowRun)

        assert result["id"] == "test"
        assert result["tenant_id"] == "tenant-123"


# ---------------------------------------------------------------------------
# Test _get_model_column_info Method
# ---------------------------------------------------------------------------


class TestGetModelColumnInfo:
    """Tests for WorkflowRunRestore._get_model_column_info method."""

    def test_column_info_extraction(self):
        """Should extract column information correctly."""
        restore = WorkflowRunRestore()

        column_names, required_columns, non_nullable_with_default = restore._get_model_column_info(WorkflowRun)

        # Check that we get some expected columns
        assert "id" in column_names
        assert "tenant_id" in column_names
        assert "app_id" in column_names
        assert "created_at" in column_names
        assert "created_by" in column_names
        assert "status" in column_names

        # Columns without defaults should be required for restore inserts.
        assert {
            "tenant_id",
            "app_id",
            "workflow_id",
            "type",
            "triggered_from",
            "version",
            "status",
            "created_by_role",
            "created_by",
        }.issubset(required_columns)
        assert "id" not in required_columns
        assert "created_at" not in required_columns

        # Check columns with defaults or server defaults
        assert "id" in non_nullable_with_default
        assert "created_at" in non_nullable_with_default
        assert "elapsed_time" in non_nullable_with_default
        assert "total_tokens" in non_nullable_with_default
        assert "tenant_id" not in non_nullable_with_default

    def test_non_pk_auto_autoincrement_column_is_still_required(self):
        """`autoincrement='auto'` should not mark non-PK columns as defaulted."""
        restore = WorkflowRunRestore()

        test_table = Table(
            "test_autoincrement",
            MetaData(),
            Column("id", Integer, primary_key=True, autoincrement=True),
            Column("required_field", String(255), nullable=False),
            Column("defaulted_field", String(255), nullable=False, default="x"),
        )

        class MockModel:
            __table__ = test_table

        _, required_columns, non_nullable_with_default = restore._get_model_column_info(MockModel)

        assert required_columns == {"required_field"}
        assert "id" in non_nullable_with_default
        assert "defaulted_field" in non_nullable_with_default


# ---------------------------------------------------------------------------
# Test _restore_table_records Method
# ---------------------------------------------------------------------------


class TestRestoreTableRecords:
    """Tests for WorkflowRunRestore._restore_table_records method."""

    @patch("services.retention.workflow_run.restore_archived_workflow_run.TABLE_MODELS")
    def test_unknown_table_returns_zero(self, mock_table_models):
        """Should return 0 for unknown table."""
        restore = WorkflowRunRestore()
        mock_table_models.get.return_value = None

        mock_session = Mock()
        records = [{"id": "test"}]

        with patch("services.retention.workflow_run.restore_archived_workflow_run.logger") as mock_logger:
            result = restore._restore_table_records(mock_session, "unknown_table", records, schema_version="1.0")

        assert result == 0
        mock_logger.warning.assert_called_once_with("Unknown table: %s", "unknown_table")

    def test_empty_records_returns_zero(self):
        """Should return 0 for empty records list."""
        restore = WorkflowRunRestore()
        mock_session = Mock()

        result = restore._restore_table_records(mock_session, "workflow_runs", [], schema_version="1.0")
        assert result == 0

    @patch("services.retention.workflow_run.restore_archived_workflow_run.pg_insert")
    @patch("services.retention.workflow_run.restore_archived_workflow_run.cast")
    def test_successful_restore(self, mock_cast, mock_pg_insert):
        """Should successfully restore records."""
        restore = WorkflowRunRestore()

        # Mock session and execution
        mock_session = Mock()
        mock_result = Mock()
        mock_result.rowcount = 2
        mock_session.execute.return_value = mock_result
        mock_cast.return_value = mock_result

        # Mock insert statement
        mock_stmt = Mock()
        mock_stmt.on_conflict_do_nothing.return_value = mock_stmt
        mock_pg_insert.return_value = mock_stmt

        records = [
            {
                "id": "test1",
                "tenant_id": "tenant-123",
                "app_id": "app-123",
                "workflow_id": "workflow-123",
                "type": "workflow",
                "triggered_from": "app",
                "version": "1",
                "status": "succeeded",
                "created_by_role": "account",
                "created_by": "user-123",
            },
            {
                "id": "test2",
                "tenant_id": "tenant-123",
                "app_id": "app-123",
                "workflow_id": "workflow-123",
                "type": "workflow",
                "triggered_from": "app",
                "version": "1",
                "status": "succeeded",
                "created_by_role": "account",
                "created_by": "user-123",
            },
        ]

        result = restore._restore_table_records(mock_session, "workflow_runs", records, schema_version="1.0")

        assert result == 2
        mock_session.execute.assert_called_once()

    def test_missing_required_columns_raises_error(self):
        """Should raise ValueError for missing required columns."""
        restore = WorkflowRunRestore()

        mock_session = Mock()
        # Use a dedicated mock model to isolate required-column validation behavior.
        mock_model = Mock()

        # Mock a required column
        required_column = Mock()
        required_column.key = "required_field"
        required_column.nullable = False
        required_column.default = None
        required_column.server_default = None
        required_column.autoincrement = False
        required_column.type = Mock()

        # Mock the __table__ attribute properly
        mock_table = Mock()
        mock_table.columns = [required_column]
        mock_model.__table__ = mock_table

        records = [{"name": "test"}]  # Missing required 'required_field'

        with patch.dict(TABLE_MODELS, {"test_table": mock_model}):
            with pytest.raises(ValueError, match="Missing required columns for test_table"):
                restore._restore_table_records(mock_session, "test_table", records, schema_version="1.0")


# ---------------------------------------------------------------------------
# Test _restore_from_run Method
# ---------------------------------------------------------------------------


class TestRestoreFromRun:
    """Tests for WorkflowRunRestore._restore_from_run method."""

    @patch("services.retention.workflow_run.restore_archived_workflow_run.get_archive_storage")
    def test_archive_storage_not_configured(self, mock_get_storage):
        """Should handle ArchiveStorageNotConfiguredError."""
        restore = WorkflowRunRestore()
        mock_get_storage.side_effect = ArchiveStorageNotConfiguredError("Storage not configured")

        run = WorkflowRunRestoreTestDataFactory.create_workflow_run_mock()

        with patch("services.retention.workflow_run.restore_archived_workflow_run.click") as mock_click:
            result = restore._restore_from_run(run, session_maker=lambda: Mock())

        assert result.success is False
        assert "Storage not configured" in result.error
        assert result.elapsed_time > 0

    @patch("services.retention.workflow_run.restore_archived_workflow_run.get_archive_storage")
    def test_archive_bundle_not_found(self, mock_get_storage):
        """Should handle FileNotFoundError when archive bundle is missing."""
        restore = WorkflowRunRestore()
        mock_storage = Mock()
        mock_storage.get_object.side_effect = FileNotFoundError("Bundle not found")
        mock_get_storage.return_value = mock_storage

        run = WorkflowRunRestoreTestDataFactory.create_workflow_run_mock()

        with patch("services.retention.workflow_run.restore_archived_workflow_run.click") as mock_click:
            result = restore._restore_from_run(run, session_maker=lambda: Mock())

        assert result.success is False
        assert "Archive bundle not found" in result.error

    @patch("services.retention.workflow_run.restore_archived_workflow_run.get_archive_storage")
    def test_dry_run_mode(self, mock_get_storage):
        """Should handle dry run mode correctly."""
        restore = WorkflowRunRestore(dry_run=True)

        # Mock storage and archive data
        mock_storage = Mock()
        archive_data = WorkflowRunRestoreTestDataFactory.create_archive_zip_mock()
        mock_storage.get_object.return_value = archive_data
        mock_get_storage.return_value = mock_storage

        run = WorkflowRunRestoreTestDataFactory.create_workflow_run_mock()

        # Create a proper mock session with context manager support
        mock_session = Mock()
        mock_session.__enter__ = Mock(return_value=mock_session)
        mock_session.__exit__ = Mock(return_value=None)

        result = restore._restore_from_run(run, session_maker=lambda: mock_session)

        assert result.success is True
        assert result.restored_counts["workflow_runs"] == 1
        assert result.restored_counts["workflow_app_logs"] == 2

    @patch("services.retention.workflow_run.restore_archived_workflow_run.get_archive_storage")
    @patch("services.retention.workflow_run.restore_archived_workflow_run.pg_insert")
    @patch("services.retention.workflow_run.restore_archived_workflow_run.cast")
    def test_successful_restore(self, mock_cast, mock_pg_insert, mock_get_storage):
        """Should successfully restore from archive."""
        restore = WorkflowRunRestore()

        # Mock storage and archive data
        mock_storage = Mock()
        archive_data = WorkflowRunRestoreTestDataFactory.create_archive_zip_mock()
        mock_storage.get_object.return_value = archive_data
        mock_get_storage.return_value = mock_storage

        # Mock session with context manager support
        mock_session = Mock()
        mock_session.__enter__ = Mock(return_value=mock_session)
        mock_session.__exit__ = Mock(return_value=None)

        def session_maker():
            return mock_session

        # Mock database execution to return integer counts
        mock_result_workflow_runs = Mock()
        mock_result_workflow_runs.rowcount = 1
        mock_result_app_logs = Mock()
        mock_result_app_logs.rowcount = 2

        # Configure session.execute to return different results based on the table
        def mock_execute(stmt):
            if "workflow_runs" in str(stmt):
                return mock_result_workflow_runs
            else:
                return mock_result_app_logs

        mock_session.execute.side_effect = mock_execute
        mock_cast.return_value = mock_result_workflow_runs

        # Mock insert statement
        mock_stmt = Mock()
        mock_stmt.on_conflict_do_nothing.return_value = mock_stmt
        mock_pg_insert.return_value = mock_stmt

        run = WorkflowRunRestoreTestDataFactory.create_workflow_run_mock()

        # Mock repository methods
        with patch.object(restore, "_get_workflow_run_repo") as mock_get_repo:
            mock_repo = Mock()
            mock_get_repo.return_value = mock_repo

            with patch("services.retention.workflow_run.restore_archived_workflow_run.click") as mock_click:
                result = restore._restore_from_run(run, session_maker=session_maker)

        assert result.success is True
        assert result.restored_counts["workflow_runs"] == 1
        assert result.restored_counts["workflow_app_logs"] >= 1  # Just check it's restored
        mock_session.commit.assert_called_once()
        mock_repo.delete_archive_log_by_run_id.assert_called_once_with(mock_session, run.id)

    @patch("services.retention.workflow_run.restore_archived_workflow_run.get_archive_storage")
    def test_invalid_archive_bundle(self, mock_get_storage):
        """Should handle invalid archive bundle."""
        restore = WorkflowRunRestore()

        # Mock storage with invalid zip data
        mock_storage = Mock()
        mock_storage.get_object.return_value = b"invalid zip data"
        mock_get_storage.return_value = mock_storage

        run = WorkflowRunRestoreTestDataFactory.create_workflow_run_mock()

        # Create proper mock session
        mock_session = Mock()
        mock_session.__enter__ = Mock(return_value=mock_session)
        mock_session.__exit__ = Mock(return_value=None)

        with patch("services.retention.workflow_run.restore_archived_workflow_run.click") as mock_click:
            result = restore._restore_from_run(run, session_maker=lambda: mock_session)

        assert result.success is False
        # The error message comes from zipfile.BadZipFile which says "File is not a zip file"
        assert "File is not a zip file" in result.error

    @patch("services.retention.workflow_run.restore_archived_workflow_run.get_archive_storage")
    def test_workflow_archive_log_input(self, mock_get_storage):
        """Should handle WorkflowArchiveLog input correctly."""
        restore = WorkflowRunRestore(dry_run=True)

        # Mock storage and archive data
        mock_storage = Mock()
        archive_data = WorkflowRunRestoreTestDataFactory.create_archive_zip_mock()
        mock_storage.get_object.return_value = archive_data
        mock_get_storage.return_value = mock_storage

        archive_log = WorkflowRunRestoreTestDataFactory.create_workflow_archive_log_mock()

        # Create proper mock session
        mock_session = Mock()
        mock_session.__enter__ = Mock(return_value=mock_session)
        mock_session.__exit__ = Mock(return_value=None)

        result = restore._restore_from_run(archive_log, session_maker=lambda: mock_session)

        assert result.success is True
        assert result.run_id == archive_log.workflow_run_id
        assert result.tenant_id == archive_log.tenant_id


# ---------------------------------------------------------------------------
# Test restore_batch Method
# ---------------------------------------------------------------------------


class TestRestoreBatch:
    """Tests for WorkflowRunRestore.restore_batch method."""

    @patch("services.retention.workflow_run.restore_archived_workflow_run.sessionmaker")
    def test_empty_tenant_ids_returns_empty(self, mock_sessionmaker):
        """Should return empty list when tenant_ids is empty list."""
        restore = WorkflowRunRestore()

        # Mock db.engine to avoid SQLAlchemy issues
        with patch("services.retention.workflow_run.restore_archived_workflow_run.db") as mock_db:
            mock_db.engine = Mock()
            result = restore.restore_batch(
                tenant_ids=[],
                start_date=datetime(2024, 1, 1),
                end_date=datetime(2024, 1, 2),
            )

        assert result == []

    @patch("services.retention.workflow_run.restore_archived_workflow_run.ThreadPoolExecutor")
    def test_successful_batch_restore(self, mock_executor):
        """Should successfully restore batch of workflow runs."""
        restore = WorkflowRunRestore(workers=2)

        # Mock session that supports context manager protocol
        mock_session = Mock()
        mock_session.__enter__ = Mock(return_value=mock_session)
        mock_session.__exit__ = Mock(return_value=None)

        # Mock session factory that returns context manager sessions
        mock_session_factory = Mock(return_value=mock_session)

        # Mock repository and archive logs
        mock_repo = Mock()
        archive_log1 = WorkflowRunRestoreTestDataFactory.create_workflow_archive_log_mock("run-1")
        archive_log2 = WorkflowRunRestoreTestDataFactory.create_workflow_archive_log_mock("run-2")
        mock_repo.get_archived_logs_by_time_range.return_value = [archive_log1, archive_log2]

        # Mock restore results
        result1 = RestoreResult(run_id="run-1", tenant_id="tenant-1", success=True, restored_counts={})
        result2 = RestoreResult(run_id="run-2", tenant_id="tenant-1", success=True, restored_counts={})

        # Mock ThreadPoolExecutor with context manager support
        mock_executor_instance = Mock()
        mock_executor_instance.__enter__ = Mock(return_value=mock_executor_instance)
        mock_executor_instance.__exit__ = Mock(return_value=None)
        mock_executor_instance.map = Mock(return_value=[result1, result2])
        mock_executor.return_value = mock_executor_instance

        with patch.object(restore, "_get_workflow_run_repo", return_value=mock_repo):
            with patch.object(restore, "_restore_from_run", side_effect=[result1, result2]):
                with patch("services.retention.workflow_run.restore_archived_workflow_run.click") as mock_click:
                    # Mock sessionmaker and db.engine to avoid SQLAlchemy issues
                    with patch(
                        "services.retention.workflow_run.restore_archived_workflow_run.sessionmaker"
                    ) as mock_sessionmaker:
                        mock_sessionmaker.return_value = mock_session_factory
                        with patch("services.retention.workflow_run.restore_archived_workflow_run.db") as mock_db:
                            mock_db.engine = Mock()
                            results = restore.restore_batch(
                                tenant_ids=["tenant-1"],
                                start_date=datetime(2024, 1, 1),
                                end_date=datetime(2024, 1, 2),
                            )

        assert len(results) == 2
        assert results[0].run_id == "run-1"
        assert results[1].run_id == "run-2"

    @patch("services.retention.workflow_run.restore_archived_workflow_run.ThreadPoolExecutor")
    def test_dry_run_batch_restore(self, mock_executor):
        """Should handle dry run mode for batch restore."""
        restore = WorkflowRunRestore(dry_run=True)

        # Mock session that supports context manager protocol
        mock_session = Mock()
        mock_session.__enter__ = Mock(return_value=mock_session)
        mock_session.__exit__ = Mock(return_value=None)

        # Mock session factory that returns context manager sessions
        mock_session_factory = Mock(return_value=mock_session)

        mock_repo = Mock()
        archive_log = WorkflowRunRestoreTestDataFactory.create_workflow_archive_log_mock()
        mock_repo.get_archived_logs_by_time_range.return_value = [archive_log]

        result = RestoreResult(run_id="run-1", tenant_id="tenant-1", success=True, restored_counts={"workflow_runs": 1})

        # Mock ThreadPoolExecutor with context manager support
        mock_executor_instance = Mock()
        mock_executor_instance.__enter__ = Mock(return_value=mock_executor_instance)
        mock_executor_instance.__exit__ = Mock(return_value=None)
        mock_executor_instance.map = Mock(return_value=[result])
        mock_executor.return_value = mock_executor_instance

        with patch.object(restore, "_get_workflow_run_repo", return_value=mock_repo):
            with patch.object(restore, "_restore_from_run", return_value=result):
                with patch("services.retention.workflow_run.restore_archived_workflow_run.click") as mock_click:
                    # Mock sessionmaker and db.engine to avoid SQLAlchemy issues
                    with patch(
                        "services.retention.workflow_run.restore_archived_workflow_run.sessionmaker"
                    ) as mock_sessionmaker:
                        mock_sessionmaker.return_value = mock_session_factory
                        with patch("services.retention.workflow_run.restore_archived_workflow_run.db") as mock_db:
                            mock_db.engine = Mock()
                            results = restore.restore_batch(
                                tenant_ids=["tenant-1"],
                                start_date=datetime(2024, 1, 1),
                                end_date=datetime(2024, 1, 2),
                            )

        assert len(results) == 1
        assert results[0].success is True


# ---------------------------------------------------------------------------
# Test restore_by_run_id Method
# ---------------------------------------------------------------------------


class TestRestoreByRunId:
    """Tests for WorkflowRunRestore.restore_by_run_id method."""

    def test_archive_log_not_found(self):
        """Should handle case when archive log is not found."""
        restore = WorkflowRunRestore()

        mock_repo = Mock()
        mock_repo.get_archived_log_by_run_id.return_value = None

        with patch.object(restore, "_get_workflow_run_repo", return_value=mock_repo):
            with patch("services.retention.workflow_run.restore_archived_workflow_run.click") as mock_click:
                result = restore.restore_by_run_id("nonexistent-run")

        assert result.success is False
        assert "not found" in result.error
        assert result.run_id == "nonexistent-run"

    @patch("services.retention.workflow_run.restore_archived_workflow_run.sessionmaker")
    def test_successful_restore_by_id(self, mock_sessionmaker):
        """Should successfully restore by run ID."""
        restore = WorkflowRunRestore()

        mock_session = Mock()
        mock_sessionmaker.return_value = mock_session

        mock_repo = Mock()
        archive_log = WorkflowRunRestoreTestDataFactory.create_workflow_archive_log_mock()
        mock_repo.get_archived_log_by_run_id.return_value = archive_log

        result = RestoreResult(run_id="run-1", tenant_id="tenant-1", success=True, restored_counts={})

        with patch.object(restore, "_get_workflow_run_repo", return_value=mock_repo):
            with patch.object(restore, "_restore_from_run", return_value=result):
                with patch("services.retention.workflow_run.restore_archived_workflow_run.click") as mock_click:
                    # Mock db.engine to avoid SQLAlchemy issues
                    with patch("services.retention.workflow_run.restore_archived_workflow_run.db") as mock_db:
                        mock_db.engine = Mock()
                        actual_result = restore.restore_by_run_id("run-1")

        assert actual_result.success is True
        assert actual_result.run_id == "run-1"

    @patch("services.retention.workflow_run.restore_archived_workflow_run.sessionmaker")
    def test_dry_run_restore_by_id(self, mock_sessionmaker):
        """Should handle dry run mode for restore by ID."""
        restore = WorkflowRunRestore(dry_run=True)

        mock_session = Mock()
        mock_sessionmaker.return_value = mock_session

        mock_repo = Mock()
        archive_log = WorkflowRunRestoreTestDataFactory.create_workflow_archive_log_mock()
        mock_repo.get_archived_log_by_run_id.return_value = archive_log

        result = RestoreResult(run_id="run-1", tenant_id="tenant-1", success=True, restored_counts={"workflow_runs": 1})

        with patch.object(restore, "_get_workflow_run_repo", return_value=mock_repo):
            with patch.object(restore, "_restore_from_run", return_value=result):
                with patch("services.retention.workflow_run.restore_archived_workflow_run.click") as mock_click:
                    # Mock db.engine to avoid SQLAlchemy issues
                    with patch("services.retention.workflow_run.restore_archived_workflow_run.db") as mock_db:
                        mock_db.engine = Mock()
                        actual_result = restore.restore_by_run_id("run-1")

        assert actual_result.success is True
        assert actual_result.run_id == "run-1"


# ---------------------------------------------------------------------------
# Test RestoreResult Dataclass
# ---------------------------------------------------------------------------


class TestRestoreResult:
    """Tests for RestoreResult dataclass."""

    def test_restore_result_creation(self):
        """Should create RestoreResult with all fields."""
        result = RestoreResult(
            run_id="run-123",
            tenant_id="tenant-123",
            success=True,
            restored_counts={"workflow_runs": 1, "workflow_app_logs": 2},
            error=None,
            elapsed_time=5.5,
        )

        assert result.run_id == "run-123"
        assert result.tenant_id == "tenant-123"
        assert result.success is True
        assert result.restored_counts == {"workflow_runs": 1, "workflow_app_logs": 2}
        assert result.error is None
        assert result.elapsed_time == 5.5

    def test_restore_result_with_error(self):
        """Should create RestoreResult with error."""
        result = RestoreResult(
            run_id="run-123",
            tenant_id="tenant-123",
            success=False,
            restored_counts={},
            error="Something went wrong",
        )

        assert result.success is False
        assert result.error == "Something went wrong"
        assert result.restored_counts == {}
        assert result.elapsed_time == 0.0  # Default value


# ---------------------------------------------------------------------------
# Test Constants and Mappings
# ---------------------------------------------------------------------------


class TestConstantsAndMappings:
    """Tests for module constants and mappings."""

    def test_table_models_mapping(self):
        """TABLE_MODELS should contain expected table mappings."""
        expected_tables = {
            "workflow_runs": WorkflowRun,
            "workflow_app_logs": WorkflowAppLog,
            "workflow_node_executions": WorkflowNodeExecutionModel,
            "workflow_node_execution_offload": WorkflowNodeExecutionOffload,
            "workflow_pauses": WorkflowPause,
            "workflow_pause_reasons": WorkflowPauseReason,
            "workflow_trigger_logs": WorkflowTriggerLog,
        }

        assert expected_tables == TABLE_MODELS

    def test_schema_mappers_structure(self):
        """SCHEMA_MAPPERS should have correct structure."""
        assert isinstance(SCHEMA_MAPPERS, dict)
        assert "1.0" in SCHEMA_MAPPERS
        assert isinstance(SCHEMA_MAPPERS["1.0"], dict)


# ---------------------------------------------------------------------------
# Integration Tests
# ---------------------------------------------------------------------------


class TestIntegration:
    """Integration tests combining multiple components."""

    @patch("services.retention.workflow_run.restore_archived_workflow_run.get_archive_storage")
    @patch("services.retention.workflow_run.restore_archived_workflow_run.ThreadPoolExecutor")
    def test_full_restore_flow(self, mock_executor, mock_get_storage):
        """Test complete restore flow with all components."""
        restore = WorkflowRunRestore(workers=1)

        # Mock storage
        mock_storage = Mock()
        manifest = {
            "schema_version": "1.0",
            "tables": {
                "workflow_runs": {"row_count": 1},
            },
        }
        tables_data = {
            "workflow_runs": [
                {
                    "id": "run-123",
                    "tenant_id": "tenant-123",
                    "app_id": "app-123",
                    "workflow_id": "workflow-123",
                    "type": "workflow",
                    "triggered_from": "app",
                    "version": "1",
                    "status": "succeeded",
                    "created_by_role": "account",
                    "created_by": "user-123",
                    "created_at": "2024-01-01T12:00:00",
                }
            ],
        }
        archive_data = WorkflowRunRestoreTestDataFactory.create_archive_zip_mock(manifest, tables_data)
        mock_storage.get_object.return_value = archive_data
        mock_get_storage.return_value = mock_storage

        # Mock session that supports context manager protocol
        mock_session = Mock()
        mock_session.__enter__ = Mock(return_value=mock_session)
        mock_session.__exit__ = Mock(return_value=None)

        # Mock session factory that returns context manager sessions
        mock_session_factory = Mock(return_value=mock_session)

        mock_result = Mock()
        mock_result.rowcount = 1
        mock_session.execute.return_value = mock_result

        # Mock repository
        mock_repo = Mock()
        archive_log = WorkflowRunRestoreTestDataFactory.create_workflow_archive_log_mock()
        mock_repo.get_archived_log_by_run_id.return_value = archive_log

        # Mock ThreadPoolExecutor (not actually used in restore_by_run_id but needed for patch)
        mock_executor_instance = Mock()
        mock_executor_instance.__enter__ = Mock(return_value=mock_executor_instance)
        mock_executor_instance.__exit__ = Mock(return_value=None)
        mock_executor_instance.map = Mock(return_value=[])
        mock_executor.return_value = mock_executor_instance

        with patch.object(restore, "_get_workflow_run_repo", return_value=mock_repo):
            with patch("services.retention.workflow_run.restore_archived_workflow_run.pg_insert") as mock_insert:
                mock_stmt = Mock()
                mock_stmt.on_conflict_do_nothing.return_value = mock_stmt
                mock_insert.return_value = mock_stmt

                with patch("services.retention.workflow_run.restore_archived_workflow_run.cast") as mock_cast:
                    mock_cast.return_value = mock_result

                    with patch("services.retention.workflow_run.restore_archived_workflow_run.click") as mock_click:
                        # Mock sessionmaker and db.engine to avoid SQLAlchemy issues
                        with patch(
                            "services.retention.workflow_run.restore_archived_workflow_run.sessionmaker"
                        ) as mock_sessionmaker:
                            mock_sessionmaker.return_value = mock_session_factory
                            with patch("services.retention.workflow_run.restore_archived_workflow_run.db") as mock_db:
                                mock_db.engine = Mock()
                                result = restore.restore_by_run_id("run-123")

        assert result.success is True
        assert result.restored_counts.get("workflow_runs") == 1
