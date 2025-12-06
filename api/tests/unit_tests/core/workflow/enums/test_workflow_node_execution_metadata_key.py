from core.workflow.enums import WorkflowNodeExecutionMetadataKey


class TestWorkflowNodeExecutionMetadataKey:
    """Test cases for WorkflowNodeExecutionMetadataKey enum."""

    def test_provider_response_id_exists(self):
        """Test that PROVIDER_RESPONSE_ID enum value exists."""
        assert hasattr(WorkflowNodeExecutionMetadataKey, "PROVIDER_RESPONSE_ID")
        assert WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID == "provider_response_id"

    def test_provider_response_id_type(self):
        """Test that PROVIDER_RESPONSE_ID is a string."""
        assert isinstance(WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID, str)

    def test_all_expected_keys_exist(self):
        """Test that all expected metadata keys exist."""
        expected_keys = [
            "TOTAL_TOKENS",
            "TOTAL_PRICE",
            "CURRENCY",
            "TOOL_INFO",
            "AGENT_LOG",
            "TRIGGER_INFO",
            "ITERATION_ID",
            "ITERATION_INDEX",
            "LOOP_ID",
            "LOOP_INDEX",
            "PARALLEL_ID",
            "PARALLEL_START_NODE_ID",
            "PARENT_PARALLEL_ID",
            "PARENT_PARALLEL_START_NODE_ID",
            "PARALLEL_MODE_RUN_ID",
            "ITERATION_DURATION_MAP",
            "LOOP_DURATION_MAP",
            "ERROR_STRATEGY",
            "LOOP_VARIABLE_MAP",
            "DATASOURCE_INFO",
            "PROVIDER_RESPONSE_ID",
        ]

        for key in expected_keys:
            assert hasattr(WorkflowNodeExecutionMetadataKey, key)
            enum_value = getattr(WorkflowNodeExecutionMetadataKey, key)
            assert isinstance(enum_value, str)
            assert len(enum_value) > 0

    def test_enum_is_str_enum(self):
        """Test that WorkflowNodeExecutionMetadataKey inherits from StrEnum."""
        from enum import StrEnum

        assert issubclass(WorkflowNodeExecutionMetadataKey, StrEnum)

    def test_provider_response_id_unique(self):
        """Test that PROVIDER_RESPONSE_ID value is unique."""
        all_values = [key.value for key in WorkflowNodeExecutionMetadataKey]
        assert all_values.count("provider_response_id") == 1

    def test_enum_can_be_used_as_dict_key(self):
        """Test that enum values can be used as dictionary keys."""
        metadata = {
            WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID: "test-response-id-123",
            WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 100,
        }

        assert metadata[WorkflowNodeExecutionMetadataKey.PROVIDER_RESPONSE_ID] == "test-response-id-123"
        assert metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] == 100
