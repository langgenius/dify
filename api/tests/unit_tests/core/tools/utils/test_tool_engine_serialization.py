import json
from datetime import date, datetime
from decimal import Decimal
from uuid import uuid4

import numpy as np
import pytest
import pytz

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.utils.message_transformer import ToolFileMessageTransformer, safe_json_dict, safe_json_value


class TestSafeJsonValue:
    """Test suite for safe_json_value function to ensure proper serialization of complex types"""

    def test_datetime_conversion(self):
        """Test datetime conversion with timezone handling"""
        # Test datetime with UTC timezone
        dt = datetime(2024, 1, 1, 12, 0, 0, tzinfo=pytz.UTC)
        result = safe_json_value(dt)
        assert isinstance(result, str)
        assert "2024-01-01T12:00:00+00:00" in result

        # Test datetime without timezone (should default to UTC)
        dt_no_tz = datetime(2024, 1, 1, 12, 0, 0)
        result = safe_json_value(dt_no_tz)
        assert isinstance(result, str)
        # The exact time will depend on the system's timezone, so we check the format
        assert "T" in result  # ISO format separator
        # Check that it's a valid ISO format datetime string
        assert len(result) >= 19  # At least YYYY-MM-DDTHH:MM:SS

    def test_date_conversion(self):
        """Test date conversion to ISO format"""
        test_date = date(2024, 1, 1)
        result = safe_json_value(test_date)
        assert result == "2024-01-01"

    def test_uuid_conversion(self):
        """Test UUID conversion to string"""
        test_uuid = uuid4()
        result = safe_json_value(test_uuid)
        assert isinstance(result, str)
        assert result == str(test_uuid)

    def test_decimal_conversion(self):
        """Test Decimal conversion to float"""
        test_decimal = Decimal("123.456")
        result = safe_json_value(test_decimal)
        assert result == 123.456
        assert isinstance(result, float)

    def test_bytes_conversion(self):
        """Test bytes conversion with UTF-8 decoding"""
        # Test valid UTF-8 bytes
        test_bytes = b"Hello, World!"
        result = safe_json_value(test_bytes)
        assert result == "Hello, World!"

        # Test invalid UTF-8 bytes (should fall back to hex)
        invalid_bytes = b"\xff\xfe\xfd"
        result = safe_json_value(invalid_bytes)
        assert result == "fffefd"

    def test_memoryview_conversion(self):
        """Test memoryview conversion to hex string"""
        test_bytes = b"test data"
        test_memoryview = memoryview(test_bytes)
        result = safe_json_value(test_memoryview)
        assert result == "746573742064617461"  # hex of "test data"

    def test_numpy_ndarray_conversion(self):
        """Test numpy ndarray conversion to list"""
        # Test 1D array
        test_array = np.array([1, 2, 3, 4])
        result = safe_json_value(test_array)
        assert result == [1, 2, 3, 4]

        # Test 2D array
        test_2d_array = np.array([[1, 2], [3, 4]])
        result = safe_json_value(test_2d_array)
        assert result == [[1, 2], [3, 4]]

        # Test array with float values
        test_float_array = np.array([1.5, 2.7, 3.14])
        result = safe_json_value(test_float_array)
        assert result == [1.5, 2.7, 3.14]

    def test_dict_conversion(self):
        """Test dictionary conversion using safe_json_dict"""
        test_dict = {
            "string": "value",
            "number": 42,
            "float": 3.14,
            "boolean": True,
            "list": [1, 2, 3],
            "nested": {"key": "value"},
        }
        result = safe_json_value(test_dict)
        assert isinstance(result, dict)
        assert result == test_dict

    def test_list_conversion(self):
        """Test list conversion with mixed types"""
        test_list = [
            "string",
            42,
            3.14,
            True,
            [1, 2, 3],
            {"key": "value"},
            datetime(2024, 1, 1, 12, 0, 0, tzinfo=pytz.UTC),
            Decimal("123.456"),
            uuid4(),
        ]
        result = safe_json_value(test_list)
        assert isinstance(result, list)
        assert len(result) == len(test_list)
        assert isinstance(result[6], str)  # datetime should be converted to string
        assert isinstance(result[7], float)  # Decimal should be converted to float
        assert isinstance(result[8], str)  # UUID should be converted to string

    def test_tuple_conversion(self):
        """Test tuple conversion to list"""
        test_tuple = (1, "string", 3.14)
        result = safe_json_value(test_tuple)
        assert isinstance(result, list)
        assert result == [1, "string", 3.14]

    def test_set_conversion(self):
        """Test set conversion to list"""
        test_set = {1, "string", 3.14}
        result = safe_json_value(test_set)
        assert isinstance(result, list)
        # Note: set order is not guaranteed, so we check length and content
        assert len(result) == 3
        assert 1 in result
        assert "string" in result
        assert 3.14 in result

    def test_basic_types_passthrough(self):
        """Test that basic types are passed through unchanged"""
        assert safe_json_value("string") == "string"
        assert safe_json_value(42) == 42
        assert safe_json_value(3.14) == 3.14
        assert safe_json_value(True) is True
        assert safe_json_value(False) is False
        assert safe_json_value(None) is None

    def test_nested_complex_structure(self):
        """Test complex nested structure with all types"""
        complex_data = {
            "dates": [date(2024, 1, 1), date(2024, 1, 2)],
            "timestamps": [
                datetime(2024, 1, 1, 12, 0, 0, tzinfo=pytz.UTC),
                datetime(2024, 1, 2, 12, 0, 0, tzinfo=pytz.UTC),
            ],
            "numbers": [Decimal("123.456"), Decimal("789.012")],
            "identifiers": [uuid4(), uuid4()],
            "binary_data": [b"hello", b"world"],
            "arrays": [np.array([1, 2, 3]), np.array([4, 5, 6])],
        }

        result = safe_json_value(complex_data)

        # Verify structure is maintained
        assert isinstance(result, dict)
        assert "dates" in result
        assert "timestamps" in result
        assert "numbers" in result
        assert "identifiers" in result
        assert "binary_data" in result
        assert "arrays" in result

        # Verify conversions
        assert all(isinstance(d, str) for d in result["dates"])
        assert all(isinstance(t, str) for t in result["timestamps"])
        assert all(isinstance(n, float) for n in result["numbers"])
        assert all(isinstance(i, str) for i in result["identifiers"])
        assert all(isinstance(b, str) for b in result["binary_data"])
        assert all(isinstance(a, list) for a in result["arrays"])


class TestSafeJsonDict:
    """Test suite for safe_json_dict function"""

    def test_valid_dict_conversion(self):
        """Test valid dictionary conversion"""
        test_dict = {
            "string": "value",
            "number": 42,
            "datetime": datetime(2024, 1, 1, 12, 0, 0, tzinfo=pytz.UTC),
            "decimal": Decimal("123.456"),
        }
        result = safe_json_dict(test_dict)
        assert isinstance(result, dict)
        assert result["string"] == "value"
        assert result["number"] == 42
        assert isinstance(result["datetime"], str)
        assert isinstance(result["decimal"], float)

    def test_invalid_input_type(self):
        """Test that invalid input types raise TypeError"""
        with pytest.raises(TypeError, match="safe_json_dict\\(\\) expects a dictionary \\(dict\\) as input"):
            safe_json_dict("not a dict")

        with pytest.raises(TypeError, match="safe_json_dict\\(\\) expects a dictionary \\(dict\\) as input"):
            safe_json_dict([1, 2, 3])

        with pytest.raises(TypeError, match="safe_json_dict\\(\\) expects a dictionary \\(dict\\) as input"):
            safe_json_dict(42)

    def test_empty_dict(self):
        """Test empty dictionary handling"""
        result = safe_json_dict({})
        assert result == {}

    def test_nested_dict_conversion(self):
        """Test nested dictionary conversion"""
        test_dict = {
            "level1": {
                "level2": {"datetime": datetime(2024, 1, 1, 12, 0, 0, tzinfo=pytz.UTC), "decimal": Decimal("123.456")}
            }
        }
        result = safe_json_dict(test_dict)
        assert isinstance(result["level1"]["level2"]["datetime"], str)
        assert isinstance(result["level1"]["level2"]["decimal"], float)


class TestToolInvokeMessageJsonSerialization:
    """Test suite for ToolInvokeMessage JSON serialization through safe_json_value"""

    def test_json_message_serialization(self):
        """Test JSON message serialization with complex data"""
        complex_data = {
            "timestamp": datetime(2024, 1, 1, 12, 0, 0, tzinfo=pytz.UTC),
            "amount": Decimal("123.45"),
            "id": uuid4(),
            "binary": b"test data",
            "array": np.array([1, 2, 3]),
        }

        # Create JSON message
        json_message = ToolInvokeMessage.JsonMessage(json_object=complex_data)
        message = ToolInvokeMessage(type=ToolInvokeMessage.MessageType.JSON, message=json_message)

        # Apply safe_json_value transformation
        transformed_data = safe_json_value(message.message.json_object)

        # Verify transformations
        assert isinstance(transformed_data["timestamp"], str)
        assert isinstance(transformed_data["amount"], float)
        assert isinstance(transformed_data["id"], str)
        assert isinstance(transformed_data["binary"], str)
        assert isinstance(transformed_data["array"], list)

        # Verify JSON serialization works
        json_string = json.dumps(transformed_data, ensure_ascii=False)
        assert isinstance(json_string, str)

        # Verify we can deserialize back
        deserialized = json.loads(json_string)
        assert deserialized["amount"] == 123.45
        assert deserialized["array"] == [1, 2, 3]

    def test_json_message_with_nested_structures(self):
        """Test JSON message with deeply nested complex structures"""
        nested_data = {
            "level1": {
                "level2": {
                    "level3": {
                        "dates": [date(2024, 1, 1), date(2024, 1, 2)],
                        "timestamps": [datetime(2024, 1, 1, 12, 0, 0, tzinfo=pytz.UTC)],
                        "numbers": [Decimal("1.1"), Decimal("2.2")],
                        "arrays": [np.array([1, 2]), np.array([3, 4])],
                    }
                }
            }
        }

        json_message = ToolInvokeMessage.JsonMessage(json_object=nested_data)
        message = ToolInvokeMessage(type=ToolInvokeMessage.MessageType.JSON, message=json_message)

        # Transform the data
        transformed_data = safe_json_value(message.message.json_object)

        # Verify nested transformations
        level3 = transformed_data["level1"]["level2"]["level3"]
        assert all(isinstance(d, str) for d in level3["dates"])
        assert all(isinstance(t, str) for t in level3["timestamps"])
        assert all(isinstance(n, float) for n in level3["numbers"])
        assert all(isinstance(a, list) for a in level3["arrays"])

        # Test JSON serialization
        json_string = json.dumps(transformed_data, ensure_ascii=False)
        assert isinstance(json_string, str)

        # Verify deserialization
        deserialized = json.loads(json_string)
        assert deserialized["level1"]["level2"]["level3"]["numbers"] == [1.1, 2.2]

    def test_json_message_transformer_integration(self):
        """Test integration with ToolFileMessageTransformer for JSON messages"""
        complex_data = {
            "metadata": {
                "created_at": datetime(2024, 1, 1, 12, 0, 0, tzinfo=pytz.UTC),
                "version": Decimal("1.0"),
                "tags": ["tag1", "tag2"],
            },
            "data": {"values": np.array([1.1, 2.2, 3.3]), "binary": b"binary content"},
        }

        # Create message generator
        def message_generator():
            json_message = ToolInvokeMessage.JsonMessage(json_object=complex_data)
            message = ToolInvokeMessage(type=ToolInvokeMessage.MessageType.JSON, message=json_message)
            yield message

        # Transform messages
        transformed_messages = list(
            ToolFileMessageTransformer.transform_tool_invoke_messages(
                message_generator(), user_id="test_user", tenant_id="test_tenant"
            )
        )

        assert len(transformed_messages) == 1
        transformed_message = transformed_messages[0]
        assert transformed_message.type == ToolInvokeMessage.MessageType.JSON

        # Verify the JSON object was transformed
        json_obj = transformed_message.message.json_object
        assert isinstance(json_obj["metadata"]["created_at"], str)
        assert isinstance(json_obj["metadata"]["version"], float)
        assert isinstance(json_obj["data"]["values"], list)
        assert isinstance(json_obj["data"]["binary"], str)

        # Test final JSON serialization
        final_json = json.dumps(json_obj, ensure_ascii=False)
        assert isinstance(final_json, str)

        # Verify we can deserialize
        deserialized = json.loads(final_json)
        assert deserialized["metadata"]["version"] == 1.0
        assert deserialized["data"]["values"] == [1.1, 2.2, 3.3]

    def test_edge_cases_and_error_handling(self):
        """Test edge cases and error handling in JSON serialization"""
        # Test with None values
        data_with_none = {"null_value": None, "empty_string": "", "zero": 0, "false_value": False}

        json_message = ToolInvokeMessage.JsonMessage(json_object=data_with_none)
        message = ToolInvokeMessage(type=ToolInvokeMessage.MessageType.JSON, message=json_message)

        transformed_data = safe_json_value(message.message.json_object)
        json_string = json.dumps(transformed_data, ensure_ascii=False)

        # Verify serialization works with edge cases
        assert json_string is not None
        deserialized = json.loads(json_string)
        assert deserialized["null_value"] is None
        assert deserialized["empty_string"] == ""
        assert deserialized["zero"] == 0
        assert deserialized["false_value"] is False

        # Test with very large numbers
        large_data = {
            "large_int": 2**63 - 1,
            "large_float": 1.7976931348623157e308,
            "small_float": 2.2250738585072014e-308,
        }

        json_message = ToolInvokeMessage.JsonMessage(json_object=large_data)
        message = ToolInvokeMessage(type=ToolInvokeMessage.MessageType.JSON, message=json_message)

        transformed_data = safe_json_value(message.message.json_object)
        json_string = json.dumps(transformed_data, ensure_ascii=False)

        # Verify large numbers are handled correctly
        deserialized = json.loads(json_string)
        assert deserialized["large_int"] == 2**63 - 1
        assert deserialized["large_float"] == 1.7976931348623157e308
        assert deserialized["small_float"] == 2.2250738585072014e-308


class TestEndToEndSerialization:
    """Test suite for end-to-end serialization workflow"""

    def test_complete_workflow_with_real_data(self):
        """Test complete workflow from complex data to JSON string and back"""
        # Simulate real-world complex data structure
        real_world_data = {
            "user_profile": {
                "id": uuid4(),
                "name": "John Doe",
                "email": "john@example.com",
                "created_at": datetime(2024, 1, 1, 12, 0, 0, tzinfo=pytz.UTC),
                "last_login": datetime(2024, 1, 15, 14, 30, 0, tzinfo=pytz.UTC),
                "preferences": {"theme": "dark", "language": "en", "timezone": "UTC"},
            },
            "analytics": {
                "session_count": 42,
                "total_time": Decimal("123.45"),
                "metrics": np.array([1.1, 2.2, 3.3, 4.4, 5.5]),
                "events": [
                    {
                        "timestamp": datetime(2024, 1, 1, 10, 0, 0, tzinfo=pytz.UTC),
                        "action": "login",
                        "duration": Decimal("5.67"),
                    },
                    {
                        "timestamp": datetime(2024, 1, 1, 11, 0, 0, tzinfo=pytz.UTC),
                        "action": "logout",
                        "duration": Decimal("3600.0"),
                    },
                ],
            },
            "files": [
                {
                    "id": uuid4(),
                    "name": "document.pdf",
                    "size": 1024,
                    "uploaded_at": datetime(2024, 1, 1, 9, 0, 0, tzinfo=pytz.UTC),
                    "checksum": b"abc123def456",
                }
            ],
        }

        # Step 1: Create ToolInvokeMessage
        json_message = ToolInvokeMessage.JsonMessage(json_object=real_world_data)
        message = ToolInvokeMessage(type=ToolInvokeMessage.MessageType.JSON, message=json_message)

        # Step 2: Apply safe_json_value transformation
        transformed_data = safe_json_value(message.message.json_object)

        # Step 3: Serialize to JSON string
        json_string = json.dumps(transformed_data, ensure_ascii=False)

        # Step 4: Verify the string is valid JSON
        assert isinstance(json_string, str)
        assert json_string.startswith("{")
        assert json_string.endswith("}")

        # Step 5: Deserialize back to Python object
        deserialized_data = json.loads(json_string)

        # Step 6: Verify data integrity
        assert deserialized_data["user_profile"]["name"] == "John Doe"
        assert deserialized_data["user_profile"]["email"] == "john@example.com"
        assert isinstance(deserialized_data["user_profile"]["created_at"], str)
        assert isinstance(deserialized_data["analytics"]["total_time"], float)
        assert deserialized_data["analytics"]["total_time"] == 123.45
        assert isinstance(deserialized_data["analytics"]["metrics"], list)
        assert deserialized_data["analytics"]["metrics"] == [1.1, 2.2, 3.3, 4.4, 5.5]
        assert isinstance(deserialized_data["files"][0]["checksum"], str)

        # Step 7: Verify all complex types were properly converted
        self._verify_all_complex_types_converted(deserialized_data)

    def _verify_all_complex_types_converted(self, data):
        """Helper method to verify all complex types were properly converted"""
        if isinstance(data, dict):
            for key, value in data.items():
                if key in ["id", "checksum"]:
                    # These should be strings (UUID/bytes converted)
                    assert isinstance(value, str)
                elif key in ["created_at", "last_login", "timestamp", "uploaded_at"]:
                    # These should be strings (datetime converted)
                    assert isinstance(value, str)
                elif key in ["total_time", "duration"]:
                    # These should be floats (Decimal converted)
                    assert isinstance(value, float)
                elif key == "metrics":
                    # This should be a list (ndarray converted)
                    assert isinstance(value, list)
                else:
                    # Recursively check nested structures
                    self._verify_all_complex_types_converted(value)
        elif isinstance(data, list):
            for item in data:
                self._verify_all_complex_types_converted(item)
