from unittest.mock import MagicMock, patch

import pytest

from services.plugin.data_migration import PluginDataMigration


class TestPluginDataMigrationFactory:
    """Factory for PluginDataMigration unit test mocks."""

    @staticmethod
    def create_dataset_row_mock(
        record_id: str = "1",
        provider_name: str = "test",
        retrieval_model: dict | None = None,
    ) -> MagicMock:
        """Create a mock dataset row object."""
        row = MagicMock()
        row.id = record_id
        row.provider_name = provider_name
        row.retrieval_model = retrieval_model
        return row

    @staticmethod
    def create_db_record_row_mock(record_id: str, provider_name: str | None) -> MagicMock:
        """Create a mock db record row object."""
        row = MagicMock()
        row.id = record_id
        row.provider_name = provider_name
        return row


class TestPluginDataMigrationMigrate:
    """
    Unit tests for PluginDataMigration.migrate entrypoint.

    This test suite covers:
    - Basic migration functionality
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestPluginDataMigrationFactory()

    def test_migrate(self):
        """Test migrate invokes dataset and DB migration helpers."""
        # Arrange
        with (
            patch.object(PluginDataMigration, "migrate_db_records") as mock_migrate_db,
            patch.object(PluginDataMigration, "migrate_datasets") as mock_migrate_ds,
        ):
            # Act
            PluginDataMigration.migrate()

        # Assert
        assert mock_migrate_db.call_count == 10
        mock_migrate_ds.assert_called_once()


class TestPluginDataMigrationMigrateDatasets:
    """
    Unit tests for PluginDataMigration.migrate_datasets.

    This test suite covers:
    - Failed record ID skipping logic
    - Full reranking model migration branch
    - Normal path without retrieval_model
    - Empty reranking provider name handling
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestPluginDataMigrationFactory()

    @pytest.fixture
    def migration_mocks(self, mocker):
        """Reusable mocks for dataset migration tests."""
        # Mock DB connection
        db_mock = mocker.patch("services.plugin.data_migration.db")
        conn_mock = MagicMock()
        engine_ctx = MagicMock()
        engine_ctx.__enter__.return_value = conn_mock
        db_mock.engine.begin.return_value = engine_ctx

        # Mock utilities
        mocker.patch("services.plugin.data_migration.click")
        logger_mock = mocker.patch("services.plugin.data_migration.logger")

        # Mock provider ID classes
        model_provider = mocker.patch("services.plugin.data_migration.ModelProviderID")
        tool_provider = mocker.patch("services.plugin.data_migration.ToolProviderID")
        model_provider.return_value.to_string.return_value = "langgenius/test"
        tool_provider.return_value.to_string.return_value = "langgenius/tool/test"

        return conn_mock, logger_mock

    def test_migrate_datasets_skip_failed(self, migration_mocks, factory):
        """Test failed record IDs are skipped in the same batch."""
        # Arrange
        conn_mock, logger_mock = migration_mocks
        row = factory.create_dataset_row_mock(record_id="skip-id", provider_name="test", retrieval_model=None)
        conn_mock.execute.side_effect = [[row, row], Exception("Update failed"), []]

        # Act
        PluginDataMigration.migrate_datasets()

        # Assert
        assert conn_mock.execute.call_count == 2
        logger_mock.exception.assert_called_once()

    def test_migrate_datasets_full_reranking(self, migration_mocks, factory):
        """Test migration updates both provider and valid reranking provider."""
        # Arrange
        conn_mock, logger_mock = migration_mocks
        row = factory.create_dataset_row_mock(
            record_id="r2",
            provider_name="test",
            retrieval_model={"reranking_model": {"reranking_provider_name": "openai"}},
        )
        conn_mock.execute.side_effect = [[row], MagicMock(), []]

        # Act
        PluginDataMigration.migrate_datasets()

        # Assert
        assert conn_mock.execute.call_count == 3
        logger_mock.exception.assert_not_called()

    def test_migrate_datasets_normal(self, migration_mocks, factory):
        """Test basic dataset row migration without retrieval model."""
        # Arrange
        conn_mock, logger_mock = migration_mocks
        row = factory.create_dataset_row_mock()
        conn_mock.execute.side_effect = [[row], MagicMock(), []]

        # Act
        PluginDataMigration.migrate_datasets()

        # Assert
        assert conn_mock.execute.call_count == 3
        logger_mock.exception.assert_not_called()

    def test_migrate_datasets_empty_reranking_provider(self, migration_mocks, factory):
        """Test None/empty reranking_provider_name does NOT trigger rerank update."""
        # Arrange
        conn_mock, logger_mock = migration_mocks
        row = factory.create_dataset_row_mock(
            record_id="empty-batch",
            provider_name="test",
            retrieval_model={"reranking_model": {"reranking_provider_name": None}},
        )
        conn_mock.execute.side_effect = [[row], MagicMock(), []]

        # Act
        PluginDataMigration.migrate_datasets()

        # Assert
        assert conn_mock.execute.call_count == 3
        logger_mock.exception.assert_not_called()


class TestPluginDataMigrationMigrateDbRecords:
    """
    Unit tests for PluginDataMigration.migrate_db_records.

    This test suite covers:
    - Failed record ID skipping logic
    - Successful migration with ModelProviderID
    - Successful migration with ToolProviderID
    - NULL provider name handling
    - Batch update exception handling
    - No records returned handling
    """

    @pytest.fixture
    def factory(self):
        """Provide test data factory."""
        return TestPluginDataMigrationFactory()

    @pytest.fixture
    def migration_mocks(self, mocker):
        """Reusable mocks for DB record migration tests."""
        # Mock DB connection
        db_mock = mocker.patch("services.plugin.data_migration.db")
        conn_mock = MagicMock()
        engine_ctx = MagicMock()
        engine_ctx.__enter__.return_value = conn_mock
        db_mock.engine.begin.return_value = engine_ctx

        # Mock utilities
        mocker.patch("services.plugin.data_migration.click")
        logger_mock = mocker.patch("services.plugin.data_migration.logger")

        # Mock provider ID classes
        model_provider = mocker.patch("services.plugin.data_migration.ModelProviderID")
        tool_provider = mocker.patch("services.plugin.data_migration.ToolProviderID")
        model_provider.return_value.to_string.return_value = "langgenius/test"
        tool_provider.return_value.to_string.return_value = "langgenius/tool/test"

        return conn_mock, logger_mock, model_provider, tool_provider

    def test_migrate_db_records_skip_failed(self, migration_mocks, factory):
        """Test failed provider conversion IDs are added to failed_ids and skipped."""
        # Arrange
        conn_mock, logger_mock, model_provider, _ = migration_mocks
        row = factory.create_db_record_row_mock("skip-166", "test")
        model_provider.return_value.to_string.side_effect = Exception("Conversion failed")
        conn_mock.execute.side_effect = [[row], [row], []]

        # Act
        PluginDataMigration.migrate_db_records("test_table", "provider_name", model_provider)

        # Assert
        assert conn_mock.execute.call_count == 3
        logger_mock.exception.assert_called_once()

    def test_migrate_db_records_normal(self, migration_mocks, factory):
        """Test successful batch update for standard model providers."""
        # Arrange
        conn_mock, logger_mock, model_provider, _ = migration_mocks
        row = factory.create_db_record_row_mock("a", "openai")
        conn_mock.execute.side_effect = [[row], MagicMock(), []]

        # Act
        PluginDataMigration.migrate_db_records("test", "provider", model_provider)

        # Assert
        assert conn_mock.execute.call_count == 3
        logger_mock.exception.assert_not_called()

    def test_migrate_db_records_tool(self, migration_mocks, factory):
        """Test successful migration using ToolProviderID."""
        # Arrange
        conn_mock, logger_mock, _, tool_provider = migration_mocks
        row = factory.create_db_record_row_mock("t", "jina")
        conn_mock.execute.side_effect = [[row], MagicMock(), []]

        # Act
        PluginDataMigration.migrate_db_records("tool", "provider", tool_provider)

        # Assert
        assert conn_mock.execute.call_count == 3
        logger_mock.exception.assert_not_called()

    def test_migrate_db_records_provider_name_none(self, migration_mocks):
        """Test NULL provider names are filtered by SQL and not processed."""
        # Arrange
        conn_mock, logger_mock, model_provider, _ = migration_mocks
        conn_mock.execute.return_value = []

        # Act
        PluginDataMigration.migrate_db_records("test_table", "provider_name", model_provider)

        # Assert
        assert conn_mock.execute.call_count == 1
        logger_mock.exception.assert_not_called()

    def test_migrate_db_records_update_exception(self, migration_mocks, factory):
        """Test batch update exceptions are propagated to the caller."""
        # Arrange
        conn_mock, _, model_provider, _ = migration_mocks
        row = factory.create_db_record_row_mock("err-update", "test")
        conn_mock.execute.side_effect = [[row], Exception("DB update failed")]

        # Act & Assert
        with pytest.raises(Exception, match="DB update failed"):
            PluginDataMigration.migrate_db_records("test_table", "provider_name", model_provider)

        assert conn_mock.execute.call_count == 2

    def test_migrate_db_records_empty_query(self, migration_mocks):
        """Test migration exits immediately when no records are returned."""
        # Arrange
        conn_mock, _, model_provider, _ = migration_mocks
        conn_mock.execute.return_value = []

        # Act
        PluginDataMigration.migrate_db_records("test_table", "provider_name", model_provider)

        # Assert
        assert conn_mock.execute.call_count == 1
