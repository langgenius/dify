import json
import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.graph_engine.entities.runtime_route_state import RouteNodeState, RuntimeRouteState

_TEST_DATETIME = datetime(2024, 1, 15, 10, 30, 45)


class TestRouteNodeStateSerialization:
    """Test cases for RouteNodeState Pydantic serialization/deserialization."""

    def _test_route_node_state(self):
        """Test comprehensive RouteNodeState serialization with all core fields validation."""

        node_run_result = NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={"input_key": "input_value"},
            outputs={"output_key": "output_value"},
        )

        node_state = RouteNodeState(
            node_id="comprehensive_test_node",
            start_at=_TEST_DATETIME,
            finished_at=_TEST_DATETIME,
            status=RouteNodeState.Status.SUCCESS,
            node_run_result=node_run_result,
            index=5,
            paused_at=_TEST_DATETIME,
            paused_by="user_123",
            failed_reason="test_reason",
        )
        return node_state

    def test_route_node_state_comprehensive_field_validation(self):
        """Test comprehensive RouteNodeState serialization with all core fields validation."""
        node_state = self._test_route_node_state()
        serialized = node_state.model_dump()

        # Comprehensive validation of all RouteNodeState fields
        assert serialized["node_id"] == "comprehensive_test_node"
        assert serialized["status"] == RouteNodeState.Status.SUCCESS
        assert serialized["start_at"] == _TEST_DATETIME
        assert serialized["finished_at"] == _TEST_DATETIME
        assert serialized["paused_at"] == _TEST_DATETIME
        assert serialized["paused_by"] == "user_123"
        assert serialized["failed_reason"] == "test_reason"
        assert serialized["index"] == 5
        assert "id" in serialized
        assert isinstance(serialized["id"], str)
        uuid.UUID(serialized["id"])  # Validate UUID format

        # Validate nested NodeRunResult structure
        assert serialized["node_run_result"] is not None
        assert serialized["node_run_result"]["status"] == WorkflowNodeExecutionStatus.SUCCEEDED
        assert serialized["node_run_result"]["inputs"] == {"input_key": "input_value"}
        assert serialized["node_run_result"]["outputs"] == {"output_key": "output_value"}

    def test_route_node_state_minimal_required_fields(self):
        """Test RouteNodeState with only required fields, focusing on defaults."""
        node_state = RouteNodeState(node_id="minimal_node", start_at=_TEST_DATETIME)

        serialized = node_state.model_dump()

        # Focus on required fields and default values (not re-testing all fields)
        assert serialized["node_id"] == "minimal_node"
        assert serialized["start_at"] == _TEST_DATETIME
        assert serialized["status"] == RouteNodeState.Status.RUNNING  # Default status
        assert serialized["index"] == 1  # Default index
        assert serialized["node_run_result"] is None  # Default None
        json = node_state.model_dump_json()
        deserialized = RouteNodeState.model_validate_json(json)
        assert deserialized == node_state

    def test_route_node_state_deserialization_from_dict(self):
        """Test RouteNodeState deserialization from dictionary data."""
        test_datetime = datetime(2024, 1, 15, 10, 30, 45)
        test_id = str(uuid.uuid4())

        dict_data = {
            "id": test_id,
            "node_id": "deserialized_node",
            "start_at": test_datetime,
            "status": "success",
            "finished_at": test_datetime,
            "index": 3,
        }

        node_state = RouteNodeState.model_validate(dict_data)

        # Focus on deserialization accuracy
        assert node_state.id == test_id
        assert node_state.node_id == "deserialized_node"
        assert node_state.start_at == test_datetime
        assert node_state.status == RouteNodeState.Status.SUCCESS
        assert node_state.finished_at == test_datetime
        assert node_state.index == 3

    def test_route_node_state_round_trip_consistency(self):
        node_states = (
            self._test_route_node_state(),
            RouteNodeState(node_id="minimal_node", start_at=_TEST_DATETIME),
        )
        for node_state in node_states:
            json = node_state.model_dump_json()
            deserialized = RouteNodeState.model_validate_json(json)
            assert deserialized == node_state

            dict_ = node_state.model_dump(mode="python")
            deserialized = RouteNodeState.model_validate(dict_)
            assert deserialized == node_state

            dict_ = node_state.model_dump(mode="json")
            deserialized = RouteNodeState.model_validate(dict_)
            assert deserialized == node_state


class TestRouteNodeStateEnumSerialization:
    """Dedicated tests for RouteNodeState Status enum serialization behavior."""

    def test_status_enum_model_dump_behavior(self):
        """Test Status enum serialization in model_dump() returns enum objects."""

        for status_enum in RouteNodeState.Status:
            node_state = RouteNodeState(node_id="enum_test", start_at=_TEST_DATETIME, status=status_enum)
            serialized = node_state.model_dump(mode="python")
            assert serialized["status"] == status_enum
            serialized = node_state.model_dump(mode="json")
            assert serialized["status"] == status_enum.value

    def test_status_enum_json_serialization_behavior(self):
        """Test Status enum serialization in JSON returns string values."""
        test_datetime = datetime(2024, 1, 15, 10, 30, 45)

        enum_to_string_mapping = {
            RouteNodeState.Status.RUNNING: "running",
            RouteNodeState.Status.SUCCESS: "success",
            RouteNodeState.Status.FAILED: "failed",
            RouteNodeState.Status.PAUSED: "paused",
            RouteNodeState.Status.EXCEPTION: "exception",
        }

        for status_enum, expected_string in enum_to_string_mapping.items():
            node_state = RouteNodeState(node_id="json_enum_test", start_at=test_datetime, status=status_enum)

            json_data = json.loads(node_state.model_dump_json())
            assert json_data["status"] == expected_string

    def test_status_enum_deserialization_from_string(self):
        """Test Status enum deserialization from string values."""
        test_datetime = datetime(2024, 1, 15, 10, 30, 45)

        string_to_enum_mapping = {
            "running": RouteNodeState.Status.RUNNING,
            "success": RouteNodeState.Status.SUCCESS,
            "failed": RouteNodeState.Status.FAILED,
            "paused": RouteNodeState.Status.PAUSED,
            "exception": RouteNodeState.Status.EXCEPTION,
        }

        for status_string, expected_enum in string_to_enum_mapping.items():
            dict_data = {
                "node_id": "enum_deserialize_test",
                "start_at": test_datetime,
                "status": status_string,
            }

            node_state = RouteNodeState.model_validate(dict_data)
            assert node_state.status == expected_enum


class TestRuntimeRouteStateSerialization:
    """Test cases for RuntimeRouteState Pydantic serialization/deserialization."""

    _NODE1_ID = "node_1"
    _ROUTE_STATE1_ID = str(uuid.uuid4())
    _NODE2_ID = "node_2"
    _ROUTE_STATE2_ID = str(uuid.uuid4())
    _NODE3_ID = "node_3"
    _ROUTE_STATE3_ID = str(uuid.uuid4())

    def _get_runtime_route_state(self):
        # Create node states with different configurations
        node_state_1 = RouteNodeState(
            id=self._ROUTE_STATE1_ID,
            node_id=self._NODE1_ID,
            start_at=_TEST_DATETIME,
            index=1,
        )
        node_state_2 = RouteNodeState(
            id=self._ROUTE_STATE2_ID,
            node_id=self._NODE2_ID,
            start_at=_TEST_DATETIME,
            status=RouteNodeState.Status.SUCCESS,
            finished_at=_TEST_DATETIME,
            index=2,
        )
        node_state_3 = RouteNodeState(
            id=self._ROUTE_STATE3_ID,
            node_id=self._NODE3_ID,
            start_at=_TEST_DATETIME,
            status=RouteNodeState.Status.FAILED,
            failed_reason="Test failure",
            index=3,
        )

        runtime_state = RuntimeRouteState(
            routes={node_state_1.id: [node_state_2.id, node_state_3.id], node_state_2.id: [node_state_3.id]},
            node_state_mapping={
                node_state_1.id: node_state_1,
                node_state_2.id: node_state_2,
                node_state_3.id: node_state_3,
            },
        )

        return runtime_state

    def test_runtime_route_state_comprehensive_structure_validation(self):
        """Test comprehensive RuntimeRouteState serialization with full structure validation."""

        runtime_state = self._get_runtime_route_state()
        serialized = runtime_state.model_dump()

        # Comprehensive validation of RuntimeRouteState structure
        assert "routes" in serialized
        assert "node_state_mapping" in serialized
        assert isinstance(serialized["routes"], dict)
        assert isinstance(serialized["node_state_mapping"], dict)

        # Validate routes dictionary structure and content
        assert len(serialized["routes"]) == 2
        assert self._ROUTE_STATE1_ID in serialized["routes"]
        assert self._ROUTE_STATE2_ID in serialized["routes"]
        assert serialized["routes"][self._ROUTE_STATE1_ID] == [self._ROUTE_STATE2_ID, self._ROUTE_STATE3_ID]
        assert serialized["routes"][self._ROUTE_STATE2_ID] == [self._ROUTE_STATE3_ID]

        # Validate node_state_mapping dictionary structure and content
        assert len(serialized["node_state_mapping"]) == 3
        for state_id in [
            self._ROUTE_STATE1_ID,
            self._ROUTE_STATE2_ID,
            self._ROUTE_STATE3_ID,
        ]:
            assert state_id in serialized["node_state_mapping"]
            node_data = serialized["node_state_mapping"][state_id]
            node_state = runtime_state.node_state_mapping[state_id]
            assert node_data["node_id"] == node_state.node_id
            assert node_data["status"] == node_state.status
            assert node_data["index"] == node_state.index

    def test_runtime_route_state_empty_collections(self):
        """Test RuntimeRouteState with empty collections, focusing on default behavior."""
        runtime_state = RuntimeRouteState()
        serialized = runtime_state.model_dump()

        # Focus on default empty collection behavior
        assert serialized["routes"] == {}
        assert serialized["node_state_mapping"] == {}
        assert isinstance(serialized["routes"], dict)
        assert isinstance(serialized["node_state_mapping"], dict)

    def test_runtime_route_state_json_serialization_structure(self):
        """Test RuntimeRouteState JSON serialization structure."""
        node_state = RouteNodeState(node_id="json_node", start_at=_TEST_DATETIME)

        runtime_state = RuntimeRouteState(
            routes={"source": ["target1", "target2"]}, node_state_mapping={node_state.id: node_state}
        )

        json_str = runtime_state.model_dump_json()
        json_data = json.loads(json_str)

        # Focus on JSON structure validation
        assert isinstance(json_str, str)
        assert isinstance(json_data, dict)
        assert "routes" in json_data
        assert "node_state_mapping" in json_data
        assert json_data["routes"]["source"] == ["target1", "target2"]
        assert node_state.id in json_data["node_state_mapping"]

    def test_runtime_route_state_deserialization_from_dict(self):
        """Test RuntimeRouteState deserialization from dictionary data."""
        node_id = str(uuid.uuid4())

        dict_data = {
            "routes": {"source_node": ["target_node_1", "target_node_2"]},
            "node_state_mapping": {
                node_id: {
                    "id": node_id,
                    "node_id": "test_node",
                    "start_at": _TEST_DATETIME,
                    "status": "running",
                    "index": 1,
                }
            },
        }

        runtime_state = RuntimeRouteState.model_validate(dict_data)

        # Focus on deserialization accuracy
        assert runtime_state.routes == {"source_node": ["target_node_1", "target_node_2"]}
        assert len(runtime_state.node_state_mapping) == 1
        assert node_id in runtime_state.node_state_mapping

        deserialized_node = runtime_state.node_state_mapping[node_id]
        assert deserialized_node.node_id == "test_node"
        assert deserialized_node.status == RouteNodeState.Status.RUNNING
        assert deserialized_node.index == 1

    def test_runtime_route_state_round_trip_consistency(self):
        """Test RuntimeRouteState round-trip serialization consistency."""
        original = self._get_runtime_route_state()

        # Dictionary round trip
        dict_data = original.model_dump(mode="python")
        reconstructed = RuntimeRouteState.model_validate(dict_data)
        assert reconstructed == original

        dict_data = original.model_dump(mode="json")
        reconstructed = RuntimeRouteState.model_validate(dict_data)
        assert reconstructed == original

        # JSON round trip
        json_str = original.model_dump_json()
        json_reconstructed = RuntimeRouteState.model_validate_json(json_str)
        assert json_reconstructed == original


class TestSerializationEdgeCases:
    """Test edge cases and error conditions for serialization/deserialization."""

    def test_invalid_status_deserialization(self):
        """Test deserialization with invalid status values."""
        test_datetime = _TEST_DATETIME
        invalid_data = {
            "node_id": "invalid_test",
            "start_at": test_datetime,
            "status": "invalid_status",
        }

        with pytest.raises(ValidationError) as exc_info:
            RouteNodeState.model_validate(invalid_data)
        assert "status" in str(exc_info.value)

    def test_missing_required_fields_deserialization(self):
        """Test deserialization with missing required fields."""
        incomplete_data = {"id": str(uuid.uuid4())}

        with pytest.raises(ValidationError) as exc_info:
            RouteNodeState.model_validate(incomplete_data)
        error_str = str(exc_info.value)
        assert "node_id" in error_str or "start_at" in error_str

    def test_invalid_datetime_deserialization(self):
        """Test deserialization with invalid datetime values."""
        invalid_data = {
            "node_id": "datetime_test",
            "start_at": "invalid_datetime",
            "status": "running",
        }

        with pytest.raises(ValidationError) as exc_info:
            RouteNodeState.model_validate(invalid_data)
        assert "start_at" in str(exc_info.value)

    def test_invalid_routes_structure_deserialization(self):
        """Test RuntimeRouteState deserialization with invalid routes structure."""
        invalid_data = {
            "routes": "invalid_routes_structure",  # Should be dict
            "node_state_mapping": {},
        }

        with pytest.raises(ValidationError) as exc_info:
            RuntimeRouteState.model_validate(invalid_data)
        assert "routes" in str(exc_info.value)

    def test_timezone_handling_in_datetime_fields(self):
        """Test timezone handling in datetime field serialization."""
        utc_datetime = datetime.now(UTC)
        naive_datetime = utc_datetime.replace(tzinfo=None)

        node_state = RouteNodeState(node_id="timezone_test", start_at=naive_datetime)
        dict_ = node_state.model_dump()

        assert dict_["start_at"] == naive_datetime

        # Test round trip
        reconstructed = RouteNodeState.model_validate(dict_)
        assert reconstructed.start_at == naive_datetime
        assert reconstructed.start_at.tzinfo is None

        json = node_state.model_dump_json()

        reconstructed = RouteNodeState.model_validate_json(json)
        assert reconstructed.start_at == naive_datetime
        assert reconstructed.start_at.tzinfo is None
