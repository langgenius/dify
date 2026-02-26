"""
Comprehensive unit tests for DocumentService validation and configuration methods.

This module contains extensive unit tests for the DocumentService and DatasetService
classes, specifically focusing on validation and configuration methods for document
creation and processing.

The DatasetService provides validation methods for:
- Document form type validation (check_doc_form)
- Dataset model configuration validation (check_dataset_model_setting)
- Embedding model validation (check_embedding_model_setting)
- Reranking model validation (check_reranking_model_setting)

The DocumentService provides validation methods for:
- Document creation arguments validation (document_create_args_validate)
- Data source arguments validation (data_source_args_validate)
- Process rule arguments validation (process_rule_args_validate)

These validation methods are critical for ensuring data integrity and preventing
invalid configurations that could lead to processing errors or data corruption.

This test suite ensures:
- Correct validation of document form types
- Proper validation of model configurations
- Accurate validation of document creation arguments
- Comprehensive validation of data source arguments
- Thorough validation of process rule arguments
- Error conditions are handled correctly
- Edge cases are properly validated

================================================================================
ARCHITECTURE OVERVIEW
================================================================================

The DocumentService validation and configuration system ensures that all
document-related operations are performed with valid and consistent data.

1. Document Form Validation:
   - Validates document form type matches dataset configuration
   - Prevents mismatched form types that could cause processing errors
   - Supports various form types (text_model, table_model, knowledge_card, etc.)

2. Model Configuration Validation:
   - Validates embedding model availability and configuration
   - Validates reranking model availability and configuration
   - Checks model provider tokens and initialization
   - Ensures models are available before use

3. Document Creation Validation:
   - Validates data source configuration
   - Validates process rule configuration
   - Ensures at least one of data source or process rule is provided
   - Validates all required fields are present

4. Data Source Validation:
   - Validates data source type (upload_file, notion_import, website_crawl)
   - Validates data source-specific information
   - Ensures required fields for each data source type

5. Process Rule Validation:
   - Validates process rule mode (automatic, custom, hierarchical)
   - Validates pre-processing rules
   - Validates segmentation rules
   - Ensures proper configuration for each mode

================================================================================
TESTING STRATEGY
================================================================================

This test suite follows a comprehensive testing strategy that covers:

1. Document Form Validation:
   - Matching form types (should pass)
   - Mismatched form types (should fail)
   - None/null form types handling
   - Various form type combinations

2. Model Configuration Validation:
   - Valid model configurations
   - Invalid model provider errors
   - Missing model provider tokens
   - Model availability checks

3. Document Creation Validation:
   - Valid configurations with data source
   - Valid configurations with process rule
   - Valid configurations with both
   - Missing both data source and process rule
   - Invalid configurations

4. Data Source Validation:
   - Valid upload_file configurations
   - Valid notion_import configurations
   - Valid website_crawl configurations
   - Invalid data source types
   - Missing required fields

5. Process Rule Validation:
   - Automatic mode validation
   - Custom mode validation
   - Hierarchical mode validation
   - Invalid mode handling
   - Missing required fields
   - Invalid field types

================================================================================
"""

from unittest.mock import Mock, patch

import pytest

from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_runtime.entities.model_entities import ModelType
from models.dataset import Dataset, DatasetProcessRule, Document
from services.dataset_service import DatasetService, DocumentService
from services.entities.knowledge_entities.knowledge_entities import (
    DataSource,
    FileInfo,
    InfoList,
    KnowledgeConfig,
    NotionInfo,
    NotionPage,
    PreProcessingRule,
    ProcessRule,
    Rule,
    Segmentation,
    WebsiteInfo,
)

# ============================================================================
# Test Data Factory
# ============================================================================


class DocumentValidationTestDataFactory:
    """
    Factory class for creating test data and mock objects for document validation tests.

    This factory provides static methods to create mock objects for:
    - Dataset instances with various configurations
    - KnowledgeConfig instances with different settings
    - Model manager mocks
    - Data source configurations
    - Process rule configurations

    The factory methods help maintain consistency across tests and reduce
    code duplication when setting up test scenarios.
    """

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        doc_form: str | None = None,
        indexing_technique: str = "high_quality",
        embedding_model_provider: str = "openai",
        embedding_model: str = "text-embedding-ada-002",
        **kwargs,
    ) -> Mock:
        """
        Create a mock Dataset with specified attributes.

        Args:
            dataset_id: Unique identifier for the dataset
            tenant_id: Tenant identifier
            doc_form: Document form type
            indexing_technique: Indexing technique
            embedding_model_provider: Embedding model provider
            embedding_model: Embedding model name
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a Dataset instance
        """
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.doc_form = doc_form
        dataset.indexing_technique = indexing_technique
        dataset.embedding_model_provider = embedding_model_provider
        dataset.embedding_model = embedding_model
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset

    @staticmethod
    def create_knowledge_config_mock(
        data_source: DataSource | None = None,
        process_rule: ProcessRule | None = None,
        doc_form: str = "text_model",
        indexing_technique: str = "high_quality",
        **kwargs,
    ) -> Mock:
        """
        Create a mock KnowledgeConfig with specified attributes.

        Args:
            data_source: Data source configuration
            process_rule: Process rule configuration
            doc_form: Document form type
            indexing_technique: Indexing technique
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a KnowledgeConfig instance
        """
        config = Mock(spec=KnowledgeConfig)
        config.data_source = data_source
        config.process_rule = process_rule
        config.doc_form = doc_form
        config.indexing_technique = indexing_technique
        for key, value in kwargs.items():
            setattr(config, key, value)
        return config

    @staticmethod
    def create_data_source_mock(
        data_source_type: str = "upload_file",
        file_ids: list[str] | None = None,
        notion_info_list: list[NotionInfo] | None = None,
        website_info_list: WebsiteInfo | None = None,
    ) -> Mock:
        """
        Create a mock DataSource with specified attributes.

        Args:
            data_source_type: Type of data source
            file_ids: List of file IDs for upload_file type
            notion_info_list: Notion info list for notion_import type
            website_info_list: Website info for website_crawl type

        Returns:
            Mock object configured as a DataSource instance
        """
        info_list = Mock(spec=InfoList)
        info_list.data_source_type = data_source_type

        if data_source_type == "upload_file":
            file_info = Mock(spec=FileInfo)
            file_info.file_ids = file_ids or ["file-123"]
            info_list.file_info_list = file_info
            info_list.notion_info_list = None
            info_list.website_info_list = None
        elif data_source_type == "notion_import":
            info_list.notion_info_list = notion_info_list or []
            info_list.file_info_list = None
            info_list.website_info_list = None
        elif data_source_type == "website_crawl":
            info_list.website_info_list = website_info_list
            info_list.file_info_list = None
            info_list.notion_info_list = None

        data_source = Mock(spec=DataSource)
        data_source.info_list = info_list

        return data_source

    @staticmethod
    def create_process_rule_mock(
        mode: str = "custom",
        pre_processing_rules: list[PreProcessingRule] | None = None,
        segmentation: Segmentation | None = None,
        parent_mode: str | None = None,
    ) -> Mock:
        """
        Create a mock ProcessRule with specified attributes.

        Args:
            mode: Process rule mode
            pre_processing_rules: Pre-processing rules list
            segmentation: Segmentation configuration
            parent_mode: Parent mode for hierarchical mode

        Returns:
            Mock object configured as a ProcessRule instance
        """
        rule = Mock(spec=Rule)
        rule.pre_processing_rules = pre_processing_rules or [
            Mock(spec=PreProcessingRule, id="remove_extra_spaces", enabled=True)
        ]
        rule.segmentation = segmentation or Mock(spec=Segmentation, separator="\n", max_tokens=1024, chunk_overlap=50)
        rule.parent_mode = parent_mode

        process_rule = Mock(spec=ProcessRule)
        process_rule.mode = mode
        process_rule.rules = rule

        return process_rule


# ============================================================================
# Tests for check_doc_form
# ============================================================================


class TestDatasetServiceCheckDocForm:
    """
    Comprehensive unit tests for DatasetService.check_doc_form method.

    This test class covers the document form validation functionality, which
    ensures that document form types match the dataset configuration.

    The check_doc_form method:
    1. Checks if dataset has a doc_form set
    2. Validates that provided doc_form matches dataset doc_form
    3. Raises ValueError if forms don't match

    Test scenarios include:
    - Matching form types (should pass)
     - Mismatched form types (should fail)
     - None/null form types handling
     - Various form type combinations
    """

    def test_check_doc_form_matching_forms_success(self):
        """
        Test successful validation when form types match.

        Verifies that when the document form type matches the dataset
        form type, validation passes without errors.

        This test ensures:
        - Matching form types are accepted
        - No errors are raised
        - Validation logic works correctly
        """
        # Arrange
        dataset = DocumentValidationTestDataFactory.create_dataset_mock(doc_form="text_model")
        doc_form = "text_model"

        # Act (should not raise)
        DatasetService.check_doc_form(dataset, doc_form)

        # Assert
        # No exception should be raised

    def test_check_doc_form_dataset_no_form_success(self):
        """
        Test successful validation when dataset has no form set.

        Verifies that when the dataset has no doc_form set (None), any
        form type is accepted.

        This test ensures:
        - None doc_form allows any form type
        - No errors are raised
        - Validation logic works correctly
        """
        # Arrange
        dataset = DocumentValidationTestDataFactory.create_dataset_mock(doc_form=None)
        doc_form = "text_model"

        # Act (should not raise)
        DatasetService.check_doc_form(dataset, doc_form)

        # Assert
        # No exception should be raised

    def test_check_doc_form_mismatched_forms_error(self):
        """
        Test error when form types don't match.

        Verifies that when the document form type doesn't match the dataset
        form type, a ValueError is raised.

        This test ensures:
        - Mismatched form types are rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        dataset = DocumentValidationTestDataFactory.create_dataset_mock(doc_form="text_model")
        doc_form = "table_model"  # Different form

        # Act & Assert
        with pytest.raises(ValueError, match="doc_form is different from the dataset doc_form"):
            DatasetService.check_doc_form(dataset, doc_form)

    def test_check_doc_form_different_form_types_error(self):
        """
        Test error with various form type mismatches.

        Verifies that different form type combinations are properly
        rejected when they don't match.

        This test ensures:
        - Various form type combinations are validated
        - Error handling works for all combinations
        """
        # Arrange
        dataset = DocumentValidationTestDataFactory.create_dataset_mock(doc_form="knowledge_card")
        doc_form = "text_model"  # Different form

        # Act & Assert
        with pytest.raises(ValueError, match="doc_form is different from the dataset doc_form"):
            DatasetService.check_doc_form(dataset, doc_form)


# ============================================================================
# Tests for check_dataset_model_setting
# ============================================================================


class TestDatasetServiceCheckDatasetModelSetting:
    """
    Comprehensive unit tests for DatasetService.check_dataset_model_setting method.

    This test class covers the dataset model configuration validation functionality,
    which ensures that embedding models are properly configured and available.

    The check_dataset_model_setting method:
    1. Checks if indexing_technique is high_quality
    2. Validates embedding model availability via ModelManager
    3. Handles LLMBadRequestError and ProviderTokenNotInitError
    4. Raises appropriate ValueError messages

    Test scenarios include:
    - Valid model configuration
    - Invalid model provider errors
    - Missing model provider tokens
    - Economy indexing technique (skips validation)
    """

    @pytest.fixture
    def mock_model_manager(self):
        """
        Mock ModelManager for testing.

        Provides a mocked ModelManager that can be used to verify
        model instance retrieval and error handling.
        """
        with patch("services.dataset_service.ModelManager") as mock_manager:
            yield mock_manager

    def test_check_dataset_model_setting_high_quality_success(self, mock_model_manager):
        """
        Test successful validation for high_quality indexing.

        Verifies that when a dataset uses high_quality indexing and has
        a valid embedding model, validation passes.

        This test ensures:
        - Valid model configurations are accepted
        - ModelManager is called correctly
        - No errors are raised
        """
        # Arrange
        dataset = DocumentValidationTestDataFactory.create_dataset_mock(
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embedding-ada-002",
        )

        mock_instance = Mock()
        mock_instance.get_model_instance.return_value = Mock()
        mock_model_manager.return_value = mock_instance

        # Act (should not raise)
        DatasetService.check_dataset_model_setting(dataset)

        # Assert
        mock_instance.get_model_instance.assert_called_once_with(
            tenant_id=dataset.tenant_id,
            provider=dataset.embedding_model_provider,
            model_type=ModelType.TEXT_EMBEDDING,
            model=dataset.embedding_model,
        )

    def test_check_dataset_model_setting_economy_skips_validation(self, mock_model_manager):
        """
        Test that economy indexing skips model validation.

        Verifies that when a dataset uses economy indexing, model
        validation is skipped.

        This test ensures:
        - Economy indexing doesn't require model validation
        - ModelManager is not called
        - No errors are raised
        """
        # Arrange
        dataset = DocumentValidationTestDataFactory.create_dataset_mock(indexing_technique="economy")

        # Act (should not raise)
        DatasetService.check_dataset_model_setting(dataset)

        # Assert
        mock_model_manager.assert_not_called()

    def test_check_dataset_model_setting_llm_bad_request_error(self, mock_model_manager):
        """
        Test error handling for LLMBadRequestError.

        Verifies that when ModelManager raises LLMBadRequestError,
        an appropriate ValueError is raised.

        This test ensures:
        - LLMBadRequestError is caught and converted
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        dataset = DocumentValidationTestDataFactory.create_dataset_mock(
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="invalid-model",
        )

        mock_instance = Mock()
        mock_instance.get_model_instance.side_effect = LLMBadRequestError("Model not found")
        mock_model_manager.return_value = mock_instance

        # Act & Assert
        with pytest.raises(
            ValueError,
            match="No Embedding Model available. Please configure a valid provider",
        ):
            DatasetService.check_dataset_model_setting(dataset)

    def test_check_dataset_model_setting_provider_token_error(self, mock_model_manager):
        """
        Test error handling for ProviderTokenNotInitError.

        Verifies that when ModelManager raises ProviderTokenNotInitError,
        an appropriate ValueError is raised with the error description.

        This test ensures:
        - ProviderTokenNotInitError is caught and converted
        - Error message includes the description
        - Error type is correct
        """
        # Arrange
        dataset = DocumentValidationTestDataFactory.create_dataset_mock(
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embedding-ada-002",
        )

        error_description = "Provider token not initialized"
        mock_instance = Mock()
        mock_instance.get_model_instance.side_effect = ProviderTokenNotInitError(description=error_description)
        mock_model_manager.return_value = mock_instance

        # Act & Assert
        with pytest.raises(ValueError, match=f"The dataset is unavailable, due to: {error_description}"):
            DatasetService.check_dataset_model_setting(dataset)


# ============================================================================
# Tests for check_embedding_model_setting
# ============================================================================


class TestDatasetServiceCheckEmbeddingModelSetting:
    """
    Comprehensive unit tests for DatasetService.check_embedding_model_setting method.

    This test class covers the embedding model validation functionality, which
    ensures that embedding models are properly configured and available.

    The check_embedding_model_setting method:
    1. Validates embedding model availability via ModelManager
    2. Handles LLMBadRequestError and ProviderTokenNotInitError
    3. Raises appropriate ValueError messages

    Test scenarios include:
    - Valid embedding model configuration
    - Invalid model provider errors
    - Missing model provider tokens
    - Model availability checks
    """

    @pytest.fixture
    def mock_model_manager(self):
        """
        Mock ModelManager for testing.

        Provides a mocked ModelManager that can be used to verify
        model instance retrieval and error handling.
        """
        with patch("services.dataset_service.ModelManager") as mock_manager:
            yield mock_manager

    def test_check_embedding_model_setting_success(self, mock_model_manager):
        """
        Test successful validation of embedding model.

        Verifies that when a valid embedding model is provided,
        validation passes.

        This test ensures:
        - Valid model configurations are accepted
        - ModelManager is called correctly
        - No errors are raised
        """
        # Arrange
        tenant_id = "tenant-123"
        embedding_model_provider = "openai"
        embedding_model = "text-embedding-ada-002"

        mock_instance = Mock()
        mock_instance.get_model_instance.return_value = Mock()
        mock_model_manager.return_value = mock_instance

        # Act (should not raise)
        DatasetService.check_embedding_model_setting(tenant_id, embedding_model_provider, embedding_model)

        # Assert
        mock_instance.get_model_instance.assert_called_once_with(
            tenant_id=tenant_id,
            provider=embedding_model_provider,
            model_type=ModelType.TEXT_EMBEDDING,
            model=embedding_model,
        )

    def test_check_embedding_model_setting_llm_bad_request_error(self, mock_model_manager):
        """
        Test error handling for LLMBadRequestError.

        Verifies that when ModelManager raises LLMBadRequestError,
        an appropriate ValueError is raised.

        This test ensures:
        - LLMBadRequestError is caught and converted
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        tenant_id = "tenant-123"
        embedding_model_provider = "openai"
        embedding_model = "invalid-model"

        mock_instance = Mock()
        mock_instance.get_model_instance.side_effect = LLMBadRequestError("Model not found")
        mock_model_manager.return_value = mock_instance

        # Act & Assert
        with pytest.raises(
            ValueError,
            match="No Embedding Model available. Please configure a valid provider",
        ):
            DatasetService.check_embedding_model_setting(tenant_id, embedding_model_provider, embedding_model)

    def test_check_embedding_model_setting_provider_token_error(self, mock_model_manager):
        """
        Test error handling for ProviderTokenNotInitError.

        Verifies that when ModelManager raises ProviderTokenNotInitError,
        an appropriate ValueError is raised with the error description.

        This test ensures:
        - ProviderTokenNotInitError is caught and converted
        - Error message includes the description
        - Error type is correct
        """
        # Arrange
        tenant_id = "tenant-123"
        embedding_model_provider = "openai"
        embedding_model = "text-embedding-ada-002"

        error_description = "Provider token not initialized"
        mock_instance = Mock()
        mock_instance.get_model_instance.side_effect = ProviderTokenNotInitError(description=error_description)
        mock_model_manager.return_value = mock_instance

        # Act & Assert
        with pytest.raises(ValueError, match=error_description):
            DatasetService.check_embedding_model_setting(tenant_id, embedding_model_provider, embedding_model)


# ============================================================================
# Tests for check_reranking_model_setting
# ============================================================================


class TestDatasetServiceCheckRerankingModelSetting:
    """
    Comprehensive unit tests for DatasetService.check_reranking_model_setting method.

    This test class covers the reranking model validation functionality, which
    ensures that reranking models are properly configured and available.

    The check_reranking_model_setting method:
    1. Validates reranking model availability via ModelManager
    2. Handles LLMBadRequestError and ProviderTokenNotInitError
    3. Raises appropriate ValueError messages

    Test scenarios include:
    - Valid reranking model configuration
    - Invalid model provider errors
    - Missing model provider tokens
    - Model availability checks
    """

    @pytest.fixture
    def mock_model_manager(self):
        """
        Mock ModelManager for testing.

        Provides a mocked ModelManager that can be used to verify
        model instance retrieval and error handling.
        """
        with patch("services.dataset_service.ModelManager") as mock_manager:
            yield mock_manager

    def test_check_reranking_model_setting_success(self, mock_model_manager):
        """
        Test successful validation of reranking model.

        Verifies that when a valid reranking model is provided,
        validation passes.

        This test ensures:
        - Valid model configurations are accepted
        - ModelManager is called correctly
        - No errors are raised
        """
        # Arrange
        tenant_id = "tenant-123"
        reranking_model_provider = "cohere"
        reranking_model = "rerank-english-v2.0"

        mock_instance = Mock()
        mock_instance.get_model_instance.return_value = Mock()
        mock_model_manager.return_value = mock_instance

        # Act (should not raise)
        DatasetService.check_reranking_model_setting(tenant_id, reranking_model_provider, reranking_model)

        # Assert
        mock_instance.get_model_instance.assert_called_once_with(
            tenant_id=tenant_id,
            provider=reranking_model_provider,
            model_type=ModelType.RERANK,
            model=reranking_model,
        )

    def test_check_reranking_model_setting_llm_bad_request_error(self, mock_model_manager):
        """
        Test error handling for LLMBadRequestError.

        Verifies that when ModelManager raises LLMBadRequestError,
        an appropriate ValueError is raised.

        This test ensures:
        - LLMBadRequestError is caught and converted
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        tenant_id = "tenant-123"
        reranking_model_provider = "cohere"
        reranking_model = "invalid-model"

        mock_instance = Mock()
        mock_instance.get_model_instance.side_effect = LLMBadRequestError("Model not found")
        mock_model_manager.return_value = mock_instance

        # Act & Assert
        with pytest.raises(
            ValueError,
            match="No Rerank Model available. Please configure a valid provider",
        ):
            DatasetService.check_reranking_model_setting(tenant_id, reranking_model_provider, reranking_model)

    def test_check_reranking_model_setting_provider_token_error(self, mock_model_manager):
        """
        Test error handling for ProviderTokenNotInitError.

        Verifies that when ModelManager raises ProviderTokenNotInitError,
        an appropriate ValueError is raised with the error description.

        This test ensures:
        - ProviderTokenNotInitError is caught and converted
        - Error message includes the description
        - Error type is correct
        """
        # Arrange
        tenant_id = "tenant-123"
        reranking_model_provider = "cohere"
        reranking_model = "rerank-english-v2.0"

        error_description = "Provider token not initialized"
        mock_instance = Mock()
        mock_instance.get_model_instance.side_effect = ProviderTokenNotInitError(description=error_description)
        mock_model_manager.return_value = mock_instance

        # Act & Assert
        with pytest.raises(ValueError, match=error_description):
            DatasetService.check_reranking_model_setting(tenant_id, reranking_model_provider, reranking_model)


# ============================================================================
# Tests for document_create_args_validate
# ============================================================================


class TestDocumentServiceDocumentCreateArgsValidate:
    """
    Comprehensive unit tests for DocumentService.document_create_args_validate method.

    This test class covers the document creation arguments validation functionality,
    which ensures that document creation requests have valid configurations.

    The document_create_args_validate method:
    1. Validates that at least one of data_source or process_rule is provided
    2. Validates data_source if provided
    3. Validates process_rule if provided

    Test scenarios include:
    - Valid configuration with data source only
    - Valid configuration with process rule only
    - Valid configuration with both
    - Missing both data source and process rule
    - Invalid data source configuration
    - Invalid process rule configuration
    """

    @pytest.fixture
    def mock_validation_methods(self):
        """
        Mock validation methods for testing.

        Provides mocked validation methods to isolate testing of
        document_create_args_validate logic.
        """
        with (
            patch.object(DocumentService, "data_source_args_validate") as mock_data_source_validate,
            patch.object(DocumentService, "process_rule_args_validate") as mock_process_rule_validate,
        ):
            yield {
                "data_source_validate": mock_data_source_validate,
                "process_rule_validate": mock_process_rule_validate,
            }

    def test_document_create_args_validate_with_data_source_success(self, mock_validation_methods):
        """
        Test successful validation with data source only.

        Verifies that when only data_source is provided, validation
        passes and data_source validation is called.

        This test ensures:
        - Data source only configuration is accepted
        - Data source validation is called
        - Process rule validation is not called
        """
        # Arrange
        data_source = DocumentValidationTestDataFactory.create_data_source_mock()
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(
            data_source=data_source, process_rule=None
        )

        # Act (should not raise)
        DocumentService.document_create_args_validate(knowledge_config)

        # Assert
        mock_validation_methods["data_source_validate"].assert_called_once_with(knowledge_config)
        mock_validation_methods["process_rule_validate"].assert_not_called()

    def test_document_create_args_validate_with_process_rule_success(self, mock_validation_methods):
        """
        Test successful validation with process rule only.

        Verifies that when only process_rule is provided, validation
        passes and process rule validation is called.

        This test ensures:
        - Process rule only configuration is accepted
        - Process rule validation is called
        - Data source validation is not called
        """
        # Arrange
        process_rule = DocumentValidationTestDataFactory.create_process_rule_mock()
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(
            data_source=None, process_rule=process_rule
        )

        # Act (should not raise)
        DocumentService.document_create_args_validate(knowledge_config)

        # Assert
        mock_validation_methods["process_rule_validate"].assert_called_once_with(knowledge_config)
        mock_validation_methods["data_source_validate"].assert_not_called()

    def test_document_create_args_validate_with_both_success(self, mock_validation_methods):
        """
        Test successful validation with both data source and process rule.

        Verifies that when both data_source and process_rule are provided,
        validation passes and both validations are called.

        This test ensures:
        - Both data source and process rule configuration is accepted
        - Both validations are called
        - Validation order is correct
        """
        # Arrange
        data_source = DocumentValidationTestDataFactory.create_data_source_mock()
        process_rule = DocumentValidationTestDataFactory.create_process_rule_mock()
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(
            data_source=data_source, process_rule=process_rule
        )

        # Act (should not raise)
        DocumentService.document_create_args_validate(knowledge_config)

        # Assert
        mock_validation_methods["data_source_validate"].assert_called_once_with(knowledge_config)
        mock_validation_methods["process_rule_validate"].assert_called_once_with(knowledge_config)

    def test_document_create_args_validate_missing_both_error(self):
        """
        Test error when both data source and process rule are missing.

        Verifies that when neither data_source nor process_rule is provided,
        a ValueError is raised.

        This test ensures:
        - Missing both configurations is rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(
            data_source=None, process_rule=None
        )

        # Act & Assert
        with pytest.raises(ValueError, match="Data source or Process rule is required"):
            DocumentService.document_create_args_validate(knowledge_config)


# ============================================================================
# Tests for data_source_args_validate
# ============================================================================


class TestDocumentServiceDataSourceArgsValidate:
    """
    Comprehensive unit tests for DocumentService.data_source_args_validate method.

    This test class covers the data source arguments validation functionality,
    which ensures that data source configurations are valid.

    The data_source_args_validate method:
    1. Validates data_source is provided
    2. Validates data_source_type is valid
    3. Validates data_source info_list is provided
    4. Validates data source-specific information

    Test scenarios include:
    - Valid upload_file configurations
    - Valid notion_import configurations
    - Valid website_crawl configurations
    - Invalid data source types
    - Missing required fields
    - Missing data source
    """

    def test_data_source_args_validate_upload_file_success(self):
        """
        Test successful validation of upload_file data source.

        Verifies that when a valid upload_file data source is provided,
        validation passes.

        This test ensures:
        - Valid upload_file configurations are accepted
        - File info list is validated
        - No errors are raised
        """
        # Arrange
        data_source = DocumentValidationTestDataFactory.create_data_source_mock(
            data_source_type="upload_file", file_ids=["file-123", "file-456"]
        )
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(data_source=data_source)

        # Mock Document.DATA_SOURCES
        with patch.object(Document, "DATA_SOURCES", ["upload_file", "notion_import", "website_crawl"]):
            # Act (should not raise)
            DocumentService.data_source_args_validate(knowledge_config)

        # Assert
        # No exception should be raised

    def test_data_source_args_validate_notion_import_success(self):
        """
        Test successful validation of notion_import data source.

        Verifies that when a valid notion_import data source is provided,
        validation passes.

        This test ensures:
        - Valid notion_import configurations are accepted
        - Notion info list is validated
        - No errors are raised
        """
        # Arrange
        notion_info = Mock(spec=NotionInfo)
        notion_info.credential_id = "credential-123"
        notion_info.workspace_id = "workspace-123"
        notion_info.pages = [Mock(spec=NotionPage, page_id="page-123", page_name="Test Page", type="page")]

        data_source = DocumentValidationTestDataFactory.create_data_source_mock(
            data_source_type="notion_import", notion_info_list=[notion_info]
        )
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(data_source=data_source)

        # Mock Document.DATA_SOURCES
        with patch.object(Document, "DATA_SOURCES", ["upload_file", "notion_import", "website_crawl"]):
            # Act (should not raise)
            DocumentService.data_source_args_validate(knowledge_config)

        # Assert
        # No exception should be raised

    def test_data_source_args_validate_website_crawl_success(self):
        """
        Test successful validation of website_crawl data source.

        Verifies that when a valid website_crawl data source is provided,
        validation passes.

        This test ensures:
        - Valid website_crawl configurations are accepted
        - Website info is validated
        - No errors are raised
        """
        # Arrange
        website_info = Mock(spec=WebsiteInfo)
        website_info.provider = "firecrawl"
        website_info.job_id = "job-123"
        website_info.urls = ["https://example.com"]
        website_info.only_main_content = True

        data_source = DocumentValidationTestDataFactory.create_data_source_mock(
            data_source_type="website_crawl", website_info_list=website_info
        )
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(data_source=data_source)

        # Mock Document.DATA_SOURCES
        with patch.object(Document, "DATA_SOURCES", ["upload_file", "notion_import", "website_crawl"]):
            # Act (should not raise)
            DocumentService.data_source_args_validate(knowledge_config)

        # Assert
        # No exception should be raised

    def test_data_source_args_validate_missing_data_source_error(self):
        """
        Test error when data source is missing.

        Verifies that when data_source is None, a ValueError is raised.

        This test ensures:
        - Missing data source is rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(data_source=None)

        # Act & Assert
        with pytest.raises(ValueError, match="Data source is required"):
            DocumentService.data_source_args_validate(knowledge_config)

    def test_data_source_args_validate_invalid_type_error(self):
        """
        Test error when data source type is invalid.

        Verifies that when data_source_type is not in DATA_SOURCES,
        a ValueError is raised.

        This test ensures:
        - Invalid data source types are rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        data_source = DocumentValidationTestDataFactory.create_data_source_mock(data_source_type="invalid_type")
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(data_source=data_source)

        # Mock Document.DATA_SOURCES
        with patch.object(Document, "DATA_SOURCES", ["upload_file", "notion_import", "website_crawl"]):
            # Act & Assert
            with pytest.raises(ValueError, match="Data source type is invalid"):
                DocumentService.data_source_args_validate(knowledge_config)

    def test_data_source_args_validate_missing_info_list_error(self):
        """
        Test error when info_list is missing.

        Verifies that when info_list is None, a ValueError is raised.

        This test ensures:
        - Missing info_list is rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        data_source = Mock(spec=DataSource)
        data_source.info_list = None
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(data_source=data_source)

        # Act & Assert
        with pytest.raises(ValueError, match="Data source info is required"):
            DocumentService.data_source_args_validate(knowledge_config)

    def test_data_source_args_validate_missing_file_info_error(self):
        """
        Test error when file_info_list is missing for upload_file.

        Verifies that when data_source_type is upload_file but file_info_list
        is missing, a ValueError is raised.

        This test ensures:
        - Missing file_info_list for upload_file is rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        data_source = DocumentValidationTestDataFactory.create_data_source_mock(
            data_source_type="upload_file", file_ids=None
        )
        data_source.info_list.file_info_list = None
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(data_source=data_source)

        # Mock Document.DATA_SOURCES
        with patch.object(Document, "DATA_SOURCES", ["upload_file", "notion_import", "website_crawl"]):
            # Act & Assert
            with pytest.raises(ValueError, match="File source info is required"):
                DocumentService.data_source_args_validate(knowledge_config)

    def test_data_source_args_validate_missing_notion_info_error(self):
        """
        Test error when notion_info_list is missing for notion_import.

        Verifies that when data_source_type is notion_import but notion_info_list
        is missing, a ValueError is raised.

        This test ensures:
        - Missing notion_info_list for notion_import is rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        data_source = DocumentValidationTestDataFactory.create_data_source_mock(
            data_source_type="notion_import", notion_info_list=None
        )
        data_source.info_list.notion_info_list = None
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(data_source=data_source)

        # Mock Document.DATA_SOURCES
        with patch.object(Document, "DATA_SOURCES", ["upload_file", "notion_import", "website_crawl"]):
            # Act & Assert
            with pytest.raises(ValueError, match="Notion source info is required"):
                DocumentService.data_source_args_validate(knowledge_config)

    def test_data_source_args_validate_missing_website_info_error(self):
        """
        Test error when website_info_list is missing for website_crawl.

        Verifies that when data_source_type is website_crawl but website_info_list
        is missing, a ValueError is raised.

        This test ensures:
        - Missing website_info_list for website_crawl is rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        data_source = DocumentValidationTestDataFactory.create_data_source_mock(
            data_source_type="website_crawl", website_info_list=None
        )
        data_source.info_list.website_info_list = None
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(data_source=data_source)

        # Mock Document.DATA_SOURCES
        with patch.object(Document, "DATA_SOURCES", ["upload_file", "notion_import", "website_crawl"]):
            # Act & Assert
            with pytest.raises(ValueError, match="Website source info is required"):
                DocumentService.data_source_args_validate(knowledge_config)


# ============================================================================
# Tests for process_rule_args_validate
# ============================================================================


class TestDocumentServiceProcessRuleArgsValidate:
    """
    Comprehensive unit tests for DocumentService.process_rule_args_validate method.

    This test class covers the process rule arguments validation functionality,
    which ensures that process rule configurations are valid.

    The process_rule_args_validate method:
    1. Validates process_rule is provided
    2. Validates process_rule mode is provided and valid
    3. Validates process_rule rules based on mode
    4. Validates pre-processing rules
    5. Validates segmentation rules

    Test scenarios include:
    - Automatic mode validation
    - Custom mode validation
    - Hierarchical mode validation
    - Invalid mode handling
    - Missing required fields
    - Invalid field types
    """

    def test_process_rule_args_validate_automatic_mode_success(self):
        """
        Test successful validation of automatic mode.

        Verifies that when process_rule mode is automatic, validation
        passes and rules are set to None.

        This test ensures:
        - Automatic mode is accepted
        - Rules are set to None for automatic mode
        - No errors are raised
        """
        # Arrange
        process_rule = DocumentValidationTestDataFactory.create_process_rule_mock(mode="automatic")
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(process_rule=process_rule)

        # Mock DatasetProcessRule.MODES
        with patch.object(DatasetProcessRule, "MODES", ["automatic", "custom", "hierarchical"]):
            # Act (should not raise)
            DocumentService.process_rule_args_validate(knowledge_config)

        # Assert
        assert process_rule.rules is None

    def test_process_rule_args_validate_custom_mode_success(self):
        """
        Test successful validation of custom mode.

        Verifies that when process_rule mode is custom with valid rules,
        validation passes.

        This test ensures:
        - Custom mode is accepted
        - Valid rules are accepted
        - No errors are raised
        """
        # Arrange
        pre_processing_rules = [
            Mock(spec=PreProcessingRule, id="remove_extra_spaces", enabled=True),
            Mock(spec=PreProcessingRule, id="remove_urls_emails", enabled=False),
        ]
        segmentation = Mock(spec=Segmentation, separator="\n", max_tokens=1024, chunk_overlap=50)

        process_rule = DocumentValidationTestDataFactory.create_process_rule_mock(
            mode="custom", pre_processing_rules=pre_processing_rules, segmentation=segmentation
        )
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(process_rule=process_rule)

        # Mock DatasetProcessRule.MODES
        with patch.object(DatasetProcessRule, "MODES", ["automatic", "custom", "hierarchical"]):
            # Act (should not raise)
            DocumentService.process_rule_args_validate(knowledge_config)

        # Assert
        # No exception should be raised

    def test_process_rule_args_validate_hierarchical_mode_success(self):
        """
        Test successful validation of hierarchical mode.

        Verifies that when process_rule mode is hierarchical with valid rules,
        validation passes.

        This test ensures:
        - Hierarchical mode is accepted
        - Valid rules are accepted
        - No errors are raised
        """
        # Arrange
        pre_processing_rules = [Mock(spec=PreProcessingRule, id="remove_extra_spaces", enabled=True)]
        segmentation = Mock(spec=Segmentation, separator="\n", max_tokens=1024, chunk_overlap=50)

        process_rule = DocumentValidationTestDataFactory.create_process_rule_mock(
            mode="hierarchical",
            pre_processing_rules=pre_processing_rules,
            segmentation=segmentation,
            parent_mode="paragraph",
        )
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(process_rule=process_rule)

        # Mock DatasetProcessRule.MODES
        with patch.object(DatasetProcessRule, "MODES", ["automatic", "custom", "hierarchical"]):
            # Act (should not raise)
            DocumentService.process_rule_args_validate(knowledge_config)

        # Assert
        # No exception should be raised

    def test_process_rule_args_validate_missing_process_rule_error(self):
        """
        Test error when process rule is missing.

        Verifies that when process_rule is None, a ValueError is raised.

        This test ensures:
        - Missing process rule is rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(process_rule=None)

        # Act & Assert
        with pytest.raises(ValueError, match="Process rule is required"):
            DocumentService.process_rule_args_validate(knowledge_config)

    def test_process_rule_args_validate_missing_mode_error(self):
        """
        Test error when process rule mode is missing.

        Verifies that when process_rule.mode is None or empty, a ValueError
        is raised.

        This test ensures:
        - Missing mode is rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        process_rule = DocumentValidationTestDataFactory.create_process_rule_mock()
        process_rule.mode = None
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(process_rule=process_rule)

        # Act & Assert
        with pytest.raises(ValueError, match="Process rule mode is required"):
            DocumentService.process_rule_args_validate(knowledge_config)

    def test_process_rule_args_validate_invalid_mode_error(self):
        """
        Test error when process rule mode is invalid.

        Verifies that when process_rule.mode is not in MODES, a ValueError
        is raised.

        This test ensures:
        - Invalid mode is rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        process_rule = DocumentValidationTestDataFactory.create_process_rule_mock(mode="invalid_mode")
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(process_rule=process_rule)

        # Mock DatasetProcessRule.MODES
        with patch.object(DatasetProcessRule, "MODES", ["automatic", "custom", "hierarchical"]):
            # Act & Assert
            with pytest.raises(ValueError, match="Process rule mode is invalid"):
                DocumentService.process_rule_args_validate(knowledge_config)

    def test_process_rule_args_validate_missing_rules_error(self):
        """
        Test error when rules are missing for non-automatic mode.

        Verifies that when process_rule mode is not automatic but rules
        are missing, a ValueError is raised.

        This test ensures:
        - Missing rules for non-automatic mode is rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        process_rule = DocumentValidationTestDataFactory.create_process_rule_mock(mode="custom")
        process_rule.rules = None
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(process_rule=process_rule)

        # Mock DatasetProcessRule.MODES
        with patch.object(DatasetProcessRule, "MODES", ["automatic", "custom", "hierarchical"]):
            # Act & Assert
            with pytest.raises(ValueError, match="Process rule rules is required"):
                DocumentService.process_rule_args_validate(knowledge_config)

    def test_process_rule_args_validate_missing_pre_processing_rules_error(self):
        """
        Test error when pre_processing_rules are missing.

        Verifies that when pre_processing_rules is None, a ValueError
        is raised.

        This test ensures:
        - Missing pre_processing_rules is rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        process_rule = DocumentValidationTestDataFactory.create_process_rule_mock(mode="custom")
        process_rule.rules.pre_processing_rules = None
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(process_rule=process_rule)

        # Mock DatasetProcessRule.MODES
        with patch.object(DatasetProcessRule, "MODES", ["automatic", "custom", "hierarchical"]):
            # Act & Assert
            with pytest.raises(ValueError, match="Process rule pre_processing_rules is required"):
                DocumentService.process_rule_args_validate(knowledge_config)

    def test_process_rule_args_validate_missing_pre_processing_rule_id_error(self):
        """
        Test error when pre_processing_rule id is missing.

        Verifies that when a pre_processing_rule has no id, a ValueError
        is raised.

        This test ensures:
        - Missing pre_processing_rule id is rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        pre_processing_rules = [
            Mock(spec=PreProcessingRule, id=None, enabled=True)  # Missing id
        ]
        process_rule = DocumentValidationTestDataFactory.create_process_rule_mock(
            mode="custom", pre_processing_rules=pre_processing_rules
        )
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(process_rule=process_rule)

        # Mock DatasetProcessRule.MODES
        with patch.object(DatasetProcessRule, "MODES", ["automatic", "custom", "hierarchical"]):
            # Act & Assert
            with pytest.raises(ValueError, match="Process rule pre_processing_rules id is required"):
                DocumentService.process_rule_args_validate(knowledge_config)

    def test_process_rule_args_validate_invalid_pre_processing_rule_enabled_error(self):
        """
        Test error when pre_processing_rule enabled is not boolean.

        Verifies that when a pre_processing_rule enabled is not a boolean,
        a ValueError is raised.

        This test ensures:
        - Invalid enabled type is rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        pre_processing_rules = [
            Mock(spec=PreProcessingRule, id="remove_extra_spaces", enabled="true")  # Not boolean
        ]
        process_rule = DocumentValidationTestDataFactory.create_process_rule_mock(
            mode="custom", pre_processing_rules=pre_processing_rules
        )
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(process_rule=process_rule)

        # Mock DatasetProcessRule.MODES
        with patch.object(DatasetProcessRule, "MODES", ["automatic", "custom", "hierarchical"]):
            # Act & Assert
            with pytest.raises(ValueError, match="Process rule pre_processing_rules enabled is invalid"):
                DocumentService.process_rule_args_validate(knowledge_config)

    def test_process_rule_args_validate_missing_segmentation_error(self):
        """
        Test error when segmentation is missing.

        Verifies that when segmentation is None, a ValueError is raised.

        This test ensures:
        - Missing segmentation is rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        process_rule = DocumentValidationTestDataFactory.create_process_rule_mock(mode="custom")
        process_rule.rules.segmentation = None
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(process_rule=process_rule)

        # Mock DatasetProcessRule.MODES
        with patch.object(DatasetProcessRule, "MODES", ["automatic", "custom", "hierarchical"]):
            # Act & Assert
            with pytest.raises(ValueError, match="Process rule segmentation is required"):
                DocumentService.process_rule_args_validate(knowledge_config)

    def test_process_rule_args_validate_missing_segmentation_separator_error(self):
        """
        Test error when segmentation separator is missing.

        Verifies that when segmentation.separator is None or empty,
        a ValueError is raised.

        This test ensures:
        - Missing separator is rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        segmentation = Mock(spec=Segmentation, separator=None, max_tokens=1024, chunk_overlap=50)
        process_rule = DocumentValidationTestDataFactory.create_process_rule_mock(
            mode="custom", segmentation=segmentation
        )
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(process_rule=process_rule)

        # Mock DatasetProcessRule.MODES
        with patch.object(DatasetProcessRule, "MODES", ["automatic", "custom", "hierarchical"]):
            # Act & Assert
            with pytest.raises(ValueError, match="Process rule segmentation separator is required"):
                DocumentService.process_rule_args_validate(knowledge_config)

    def test_process_rule_args_validate_invalid_segmentation_separator_error(self):
        """
        Test error when segmentation separator is not a string.

        Verifies that when segmentation.separator is not a string,
        a ValueError is raised.

        This test ensures:
        - Invalid separator type is rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        segmentation = Mock(spec=Segmentation, separator=123, max_tokens=1024, chunk_overlap=50)  # Not string
        process_rule = DocumentValidationTestDataFactory.create_process_rule_mock(
            mode="custom", segmentation=segmentation
        )
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(process_rule=process_rule)

        # Mock DatasetProcessRule.MODES
        with patch.object(DatasetProcessRule, "MODES", ["automatic", "custom", "hierarchical"]):
            # Act & Assert
            with pytest.raises(ValueError, match="Process rule segmentation separator is invalid"):
                DocumentService.process_rule_args_validate(knowledge_config)

    def test_process_rule_args_validate_missing_max_tokens_error(self):
        """
        Test error when max_tokens is missing.

        Verifies that when segmentation.max_tokens is None and mode is not
        hierarchical with full-doc parent_mode, a ValueError is raised.

        This test ensures:
        - Missing max_tokens is rejected for non-hierarchical modes
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        segmentation = Mock(spec=Segmentation, separator="\n", max_tokens=None, chunk_overlap=50)
        process_rule = DocumentValidationTestDataFactory.create_process_rule_mock(
            mode="custom", segmentation=segmentation
        )
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(process_rule=process_rule)

        # Mock DatasetProcessRule.MODES
        with patch.object(DatasetProcessRule, "MODES", ["automatic", "custom", "hierarchical"]):
            # Act & Assert
            with pytest.raises(ValueError, match="Process rule segmentation max_tokens is required"):
                DocumentService.process_rule_args_validate(knowledge_config)

    def test_process_rule_args_validate_invalid_max_tokens_error(self):
        """
        Test error when max_tokens is not an integer.

        Verifies that when segmentation.max_tokens is not an integer,
        a ValueError is raised.

        This test ensures:
        - Invalid max_tokens type is rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        segmentation = Mock(spec=Segmentation, separator="\n", max_tokens="1024", chunk_overlap=50)  # Not int
        process_rule = DocumentValidationTestDataFactory.create_process_rule_mock(
            mode="custom", segmentation=segmentation
        )
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(process_rule=process_rule)

        # Mock DatasetProcessRule.MODES
        with patch.object(DatasetProcessRule, "MODES", ["automatic", "custom", "hierarchical"]):
            # Act & Assert
            with pytest.raises(ValueError, match="Process rule segmentation max_tokens is invalid"):
                DocumentService.process_rule_args_validate(knowledge_config)

    def test_process_rule_args_validate_hierarchical_full_doc_skips_max_tokens(self):
        """
        Test that hierarchical mode with full-doc parent_mode skips max_tokens validation.

        Verifies that when process_rule mode is hierarchical and parent_mode
        is full-doc, max_tokens validation is skipped.

        This test ensures:
        - Hierarchical full-doc mode doesn't require max_tokens
        - Validation logic works correctly
        - No errors are raised
        """
        # Arrange
        segmentation = Mock(spec=Segmentation, separator="\n", max_tokens=None, chunk_overlap=50)
        process_rule = DocumentValidationTestDataFactory.create_process_rule_mock(
            mode="hierarchical", segmentation=segmentation, parent_mode="full-doc"
        )
        knowledge_config = DocumentValidationTestDataFactory.create_knowledge_config_mock(process_rule=process_rule)

        # Mock DatasetProcessRule.MODES
        with patch.object(DatasetProcessRule, "MODES", ["automatic", "custom", "hierarchical"]):
            # Act (should not raise)
            DocumentService.process_rule_args_validate(knowledge_config)

        # Assert
        # No exception should be raised


# ============================================================================
# Additional Documentation and Notes
# ============================================================================
#
# This test suite covers the core validation and configuration operations for
# document service. Additional test scenarios that could be added:
#
# 1. Document Form Validation:
#    - Testing with all supported form types
#    - Testing with empty string form types
#    - Testing with special characters in form types
#
# 2. Model Configuration Validation:
#    - Testing with different model providers
#    - Testing with different model types
#    - Testing with edge cases for model availability
#
# 3. Data Source Validation:
#    - Testing with empty file lists
#    - Testing with invalid file IDs
#    - Testing with malformed data source configurations
#
# 4. Process Rule Validation:
#    - Testing with duplicate pre-processing rule IDs
#    - Testing with edge cases for segmentation
#    - Testing with various parent_mode combinations
#
# These scenarios are not currently implemented but could be added if needed
# based on real-world usage patterns or discovered edge cases.
#
# ============================================================================
