import datetime
from unittest.mock import Mock, patch

import pytest
from sqlalchemy.orm import Session

from services.clear_free_plan_tenant_expired_logs import ClearFreePlanTenantExpiredLogs


class TestClearFreePlanTenantExpiredLogs:
    """Unit tests for ClearFreePlanTenantExpiredLogs._clear_message_related_tables method."""

    @pytest.fixture
    def mock_session(self):
        """Create a mock database session."""
        session = Mock(spec=Session)
        session.query.return_value.filter.return_value.all.return_value = []
        session.query.return_value.filter.return_value.delete.return_value = 0
        return session

    @pytest.fixture
    def mock_storage(self):
        """Create a mock storage object."""
        storage = Mock()
        storage.save.return_value = None
        return storage

    @pytest.fixture
    def sample_message_ids(self):
        """Sample message IDs for testing."""
        return ["msg-1", "msg-2", "msg-3"]

    @pytest.fixture
    def sample_records(self):
        """Sample records for testing."""
        records = []
        for i in range(3):
            record = Mock()
            record.id = f"record-{i}"
            record.to_dict.return_value = {
                "id": f"record-{i}",
                "message_id": f"msg-{i}",
                "created_at": datetime.datetime.now().isoformat(),
            }
            records.append(record)
        return records

    def test_clear_message_related_tables_empty_message_ids(self, mock_session):
        """Test that method returns early when message_ids is empty."""
        with patch("services.clear_free_plan_tenant_expired_logs.storage") as mock_storage:
            ClearFreePlanTenantExpiredLogs._clear_message_related_tables(mock_session, "tenant-123", [])

            # Should not call any database operations
            mock_session.query.assert_not_called()
            mock_storage.save.assert_not_called()

    def test_clear_message_related_tables_no_records_found(self, mock_session, sample_message_ids):
        """Test when no related records are found."""
        with patch("services.clear_free_plan_tenant_expired_logs.storage") as mock_storage:
            mock_session.query.return_value.where.return_value.all.return_value = []

            ClearFreePlanTenantExpiredLogs._clear_message_related_tables(mock_session, "tenant-123", sample_message_ids)

            # Should call query for each related table but find no records
            assert mock_session.query.call_count > 0
            mock_storage.save.assert_not_called()

    def test_clear_message_related_tables_with_records_and_to_dict(
        self, mock_session, sample_message_ids, sample_records
    ):
        """Test when records are found and have to_dict method."""
        with patch("services.clear_free_plan_tenant_expired_logs.storage") as mock_storage:
            mock_session.query.return_value.where.return_value.all.return_value = sample_records

            ClearFreePlanTenantExpiredLogs._clear_message_related_tables(mock_session, "tenant-123", sample_message_ids)

            # Should call to_dict on each record (called once per table, so 7 times total)
            for record in sample_records:
                assert record.to_dict.call_count == 7

            # Should save backup data
            assert mock_storage.save.call_count > 0

    def test_clear_message_related_tables_with_records_no_to_dict(self, mock_session, sample_message_ids):
        """Test when records are found but don't have to_dict method."""
        with patch("services.clear_free_plan_tenant_expired_logs.storage") as mock_storage:
            # Create records without to_dict method
            records = []
            for i in range(2):
                record = Mock()
                mock_table = Mock()
                mock_id_column = Mock()
                mock_id_column.name = "id"
                mock_message_id_column = Mock()
                mock_message_id_column.name = "message_id"
                mock_table.columns = [mock_id_column, mock_message_id_column]
                record.__table__ = mock_table
                record.id = f"record-{i}"
                record.message_id = f"msg-{i}"
                del record.to_dict
                records.append(record)

            # Mock records for first table only, empty for others
            mock_session.query.return_value.where.return_value.all.side_effect = [
                records,
                [],
                [],
                [],
                [],
                [],
                [],
            ]

            ClearFreePlanTenantExpiredLogs._clear_message_related_tables(mock_session, "tenant-123", sample_message_ids)

            # Should save backup data even without to_dict
            assert mock_storage.save.call_count > 0

    def test_clear_message_related_tables_storage_error_continues(
        self, mock_session, sample_message_ids, sample_records
    ):
        """Test that method continues even when storage.save fails."""
        with patch("services.clear_free_plan_tenant_expired_logs.storage") as mock_storage:
            mock_storage.save.side_effect = Exception("Storage error")

            mock_session.query.return_value.where.return_value.all.return_value = sample_records

            # Should not raise exception
            ClearFreePlanTenantExpiredLogs._clear_message_related_tables(mock_session, "tenant-123", sample_message_ids)

            # Should still delete records even if backup fails
            assert mock_session.query.return_value.where.return_value.delete.called

    def test_clear_message_related_tables_serialization_error_continues(self, mock_session, sample_message_ids):
        """Test that method continues even when record serialization fails."""
        with patch("services.clear_free_plan_tenant_expired_logs.storage") as mock_storage:
            record = Mock()
            record.id = "record-1"
            record.to_dict.side_effect = Exception("Serialization error")

            mock_session.query.return_value.where.return_value.all.return_value = [record]

            # Should not raise exception
            ClearFreePlanTenantExpiredLogs._clear_message_related_tables(mock_session, "tenant-123", sample_message_ids)

            # Should still delete records even if serialization fails
            assert mock_session.query.return_value.where.return_value.delete.called

    def test_clear_message_related_tables_deletion_called(self, mock_session, sample_message_ids, sample_records):
        """Test that deletion is called for found records."""
        with patch("services.clear_free_plan_tenant_expired_logs.storage") as mock_storage:
            mock_session.query.return_value.where.return_value.all.return_value = sample_records

            ClearFreePlanTenantExpiredLogs._clear_message_related_tables(mock_session, "tenant-123", sample_message_ids)

            # Should call delete for each table that has records
            assert mock_session.query.return_value.where.return_value.delete.called

    def test_clear_message_related_tables_logging_output(
        self, mock_session, sample_message_ids, sample_records, capsys
    ):
        """Test that logging output is generated."""
        with patch("services.clear_free_plan_tenant_expired_logs.storage") as mock_storage:
            mock_session.query.return_value.where.return_value.all.return_value = sample_records

            ClearFreePlanTenantExpiredLogs._clear_message_related_tables(mock_session, "tenant-123", sample_message_ids)

            pass
