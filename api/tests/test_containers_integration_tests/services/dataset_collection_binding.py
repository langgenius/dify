"""
Comprehensive unit tests for DatasetCollectionBindingService.

This module contains extensive unit tests for the DatasetCollectionBindingService class,
which handles dataset collection binding operations for vector database collections.
"""

from itertools import starmap
from uuid import uuid4

import pytest

from extensions.ext_database import db
from models.dataset import DatasetCollectionBinding
from services.dataset_service import DatasetCollectionBindingService


class DatasetCollectionBindingTestDataFactory:
    """
    Factory class for creating test data for dataset collection binding integration tests.

    This factory provides a static method to create and persist `DatasetCollectionBinding`
    instances in the test database.

    The factory methods help maintain consistency across tests and reduce
    code duplication when setting up test scenarios.
    """

    @staticmethod
    def create_collection_binding(
        provider_name: str = "openai",
        model_name: str = "text-embedding-ada-002",
        collection_name: str = "collection-abc",
        collection_type: str = "dataset",
    ) -> DatasetCollectionBinding:
        """
        Create a DatasetCollectionBinding with specified attributes.

        Args:
            provider_name: Name of the embedding model provider (e.g., "openai", "cohere")
            model_name: Name of the embedding model (e.g., "text-embedding-ada-002")
            collection_name: Name of the vector database collection
            collection_type: Type of collection (default: "dataset")

        Returns:
            DatasetCollectionBinding instance
        """
        binding = DatasetCollectionBinding(
            provider_name=provider_name,
            model_name=model_name,
            collection_name=collection_name,
            type=collection_type,
        )
        db.session.add(binding)
        db.session.commit()
        return binding


class TestDatasetCollectionBindingServiceGetBinding:
    """
    Comprehensive unit tests for DatasetCollectionBindingService.get_dataset_collection_binding method.

    This test class covers the main collection binding retrieval/creation functionality,
    including various provider/model combinations, collection types, and edge cases.
    """

    def test_get_dataset_collection_binding_existing_binding_success(self, db_session_with_containers):
        """
        Test successful retrieval of an existing collection binding.

        Verifies that when a binding already exists in the database for the given
        provider, model, and collection type, the method returns the existing binding
        without creating a new one.
        """
        # Arrange
        provider_name = "openai"
        model_name = "text-embedding-ada-002"
        collection_type = "dataset"
        existing_binding = DatasetCollectionBindingTestDataFactory.create_collection_binding(
            provider_name=provider_name,
            model_name=model_name,
            collection_name="existing-collection",
            collection_type=collection_type,
        )

        # Act
        result = DatasetCollectionBindingService.get_dataset_collection_binding(
            provider_name, model_name, collection_type
        )

        # Assert
        assert result.id == existing_binding.id
        assert result.collection_name == "existing-collection"

    def test_get_dataset_collection_binding_create_new_binding_success(self, db_session_with_containers):
        """
        Test successful creation of a new collection binding when none exists.

        Verifies that when no existing binding is found for the given provider,
        model, and collection type, a new binding is created and returned.
        """
        # Arrange
        provider_name = f"provider-{uuid4()}"
        model_name = f"model-{uuid4()}"
        collection_type = "dataset"

        # Act
        result = DatasetCollectionBindingService.get_dataset_collection_binding(
            provider_name, model_name, collection_type
        )

        # Assert
        assert result is not None
        assert result.provider_name == provider_name
        assert result.model_name == model_name
        assert result.type == collection_type
        assert result.collection_name is not None

    def test_get_dataset_collection_binding_different_collection_type(self, db_session_with_containers):
        """Test get_dataset_collection_binding with different collection type."""
        # Arrange
        provider_name = "openai"
        model_name = "text-embedding-ada-002"
        collection_type = "custom_type"

        # Act
        result = DatasetCollectionBindingService.get_dataset_collection_binding(
            provider_name, model_name, collection_type
        )

        # Assert
        assert result.type == collection_type
        assert result.provider_name == provider_name
        assert result.model_name == model_name

    def test_get_dataset_collection_binding_default_collection_type(self, db_session_with_containers):
        """Test get_dataset_collection_binding with default collection type parameter."""
        # Arrange
        provider_name = "openai"
        model_name = "text-embedding-ada-002"

        # Act
        result = DatasetCollectionBindingService.get_dataset_collection_binding(provider_name, model_name)

        # Assert
        assert result.type == "dataset"
        assert result.provider_name == provider_name
        assert result.model_name == model_name

    def test_get_dataset_collection_binding_different_provider_model_combination(self, db_session_with_containers):
        """Test get_dataset_collection_binding with various provider/model combinations."""
        # Arrange
        combinations = [
            ("openai", "text-embedding-ada-002"),
            ("cohere", "embed-english-v3.0"),
            ("huggingface", "sentence-transformers/all-MiniLM-L6-v2"),
        ]

        # Act
        results = list(starmap(DatasetCollectionBindingService.get_dataset_collection_binding, combinations))

        # Assert
        assert len(results) == 3
        for result, (provider, model) in zip(results, combinations):
            assert result.provider_name == provider
            assert result.model_name == model


class TestDatasetCollectionBindingServiceGetBindingByIdAndType:
    """
    Comprehensive unit tests for DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type method.

    This test class covers retrieval of specific collection bindings by ID and type,
    including successful retrieval and error handling for missing bindings.
    """

    def test_get_dataset_collection_binding_by_id_and_type_success(self, db_session_with_containers):
        """Test successful retrieval of collection binding by ID and type."""
        # Arrange
        binding = DatasetCollectionBindingTestDataFactory.create_collection_binding(
            provider_name="openai",
            model_name="text-embedding-ada-002",
            collection_name="test-collection",
            collection_type="dataset",
        )

        # Act
        result = DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type(binding.id, "dataset")

        # Assert
        assert result.id == binding.id
        assert result.provider_name == "openai"
        assert result.model_name == "text-embedding-ada-002"
        assert result.collection_name == "test-collection"
        assert result.type == "dataset"

    def test_get_dataset_collection_binding_by_id_and_type_not_found_error(self, db_session_with_containers):
        """Test error handling when collection binding is not found by ID and type."""
        # Arrange
        non_existent_id = str(uuid4())

        # Act & Assert
        with pytest.raises(ValueError, match="Dataset collection binding not found"):
            DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type(non_existent_id, "dataset")

    def test_get_dataset_collection_binding_by_id_and_type_different_collection_type(self, db_session_with_containers):
        """Test retrieval by ID and type with different collection type."""
        # Arrange
        binding = DatasetCollectionBindingTestDataFactory.create_collection_binding(
            provider_name="openai",
            model_name="text-embedding-ada-002",
            collection_name="test-collection",
            collection_type="custom_type",
        )

        # Act
        result = DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type(
            binding.id, "custom_type"
        )

        # Assert
        assert result.id == binding.id
        assert result.type == "custom_type"

    def test_get_dataset_collection_binding_by_id_and_type_default_collection_type(self, db_session_with_containers):
        """Test retrieval by ID with default collection type."""
        # Arrange
        binding = DatasetCollectionBindingTestDataFactory.create_collection_binding(
            provider_name="openai",
            model_name="text-embedding-ada-002",
            collection_name="test-collection",
            collection_type="dataset",
        )

        # Act
        result = DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type(binding.id)

        # Assert
        assert result.id == binding.id
        assert result.type == "dataset"

    def test_get_dataset_collection_binding_by_id_and_type_wrong_type_error(self, db_session_with_containers):
        """Test error when binding exists but with wrong collection type."""
        # Arrange
        binding = DatasetCollectionBindingTestDataFactory.create_collection_binding(
            provider_name="openai",
            model_name="text-embedding-ada-002",
            collection_name="test-collection",
            collection_type="dataset",
        )

        # Act & Assert
        with pytest.raises(ValueError, match="Dataset collection binding not found"):
            DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type(binding.id, "wrong_type")
