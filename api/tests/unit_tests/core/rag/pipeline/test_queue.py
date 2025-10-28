"""
Unit tests for TenantSelfTaskQueue.

These tests verify the Redis-based task queue functionality for tenant-specific
task management with proper serialization and deserialization.
"""

import json
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from core.rag.pipeline.queue import TASK_WRAPPER_PREFIX, TaskWrapper, TenantSelfTaskQueue


class TestTaskWrapper:
    """Test cases for TaskWrapper serialization/deserialization."""

    def test_serialize_simple_data(self):
        """Test serialization of simple data types."""
        data = {"key": "value", "number": 42, "list": [1, 2, 3]}
        wrapper = TaskWrapper(data)
        
        serialized = wrapper.serialize()
        assert isinstance(serialized, str)
        
        # Verify it's valid JSON
        parsed = json.loads(serialized)
        assert parsed == data

    def test_serialize_complex_data(self):
        """Test serialization of complex nested data."""
        data = {
            "nested": {
                "deep": {
                    "value": "test",
                    "numbers": [1, 2, 3, 4, 5]
                }
            },
            "unicode": "测试中文",
            "special_chars": "!@#$%^&*()"
        }
        wrapper = TaskWrapper(data)
        
        serialized = wrapper.serialize()
        parsed = json.loads(serialized)
        assert parsed == data

    def test_deserialize_valid_data(self):
        """Test deserialization of valid JSON data."""
        original_data = {"key": "value", "number": 42}
        serialized = json.dumps(original_data, ensure_ascii=False)
        
        wrapper = TaskWrapper.deserialize(serialized)
        assert wrapper.data == original_data

    def test_deserialize_invalid_json(self):
        """Test deserialization handles invalid JSON gracefully."""
        invalid_json = "{invalid json}"
        
        with pytest.raises(json.JSONDecodeError):
            TaskWrapper.deserialize(invalid_json)

    def test_serialize_ensure_ascii_false(self):
        """Test that serialization preserves Unicode characters."""
        data = {"chinese": "中文测试", "emoji": "🚀"}
        wrapper = TaskWrapper(data)
        
        serialized = wrapper.serialize()
        assert "中文测试" in serialized
        assert "🚀" in serialized


class TestTenantSelfTaskQueue:
    """Test cases for TenantSelfTaskQueue functionality."""

    @pytest.fixture
    def mock_redis_client(self):
        """Mock Redis client for testing."""
        mock_redis = MagicMock()
        return mock_redis

    @pytest.fixture
    def sample_queue(self, mock_redis_client):
        """Create a sample TenantSelfTaskQueue instance."""
        return TenantSelfTaskQueue("tenant-123", "test-key")

    def test_initialization(self, sample_queue):
        """Test queue initialization with correct key generation."""
        assert sample_queue.tenant_id == "tenant-123"
        assert sample_queue.unique_key == "test-key"
        assert sample_queue.queue == "tenant_self_test-key_task_queue:tenant-123"
        assert sample_queue.task_key == "tenant_test-key_task:tenant-123"
        assert sample_queue.DEFAULT_TASK_TTL == 60 * 60

    @patch('core.rag.pipeline.queue.redis_client')
    def test_get_task_key_exists(self, mock_redis, sample_queue):
        """Test getting task key when it exists."""
        mock_redis.get.return_value = "1"
        
        result = sample_queue.get_task_key()
        
        assert result == "1"
        mock_redis.get.assert_called_once_with("tenant_test-key_task:tenant-123")

    @patch('core.rag.pipeline.queue.redis_client')
    def test_get_task_key_not_exists(self, mock_redis, sample_queue):
        """Test getting task key when it doesn't exist."""
        mock_redis.get.return_value = None
        
        result = sample_queue.get_task_key()
        
        assert result is None
        mock_redis.get.assert_called_once_with("tenant_test-key_task:tenant-123")

    @patch('core.rag.pipeline.queue.redis_client')
    def test_set_task_waiting_time_default_ttl(self, mock_redis, sample_queue):
        """Test setting task waiting flag with default TTL."""
        sample_queue.set_task_waiting_time()
        
        mock_redis.setex.assert_called_once_with(
            "tenant_test-key_task:tenant-123", 
            3600,  # DEFAULT_TASK_TTL
            1
        )

    @patch('core.rag.pipeline.queue.redis_client')
    def test_set_task_waiting_time_custom_ttl(self, mock_redis, sample_queue):
        """Test setting task waiting flag with custom TTL."""
        custom_ttl = 1800
        sample_queue.set_task_waiting_time(custom_ttl)
        
        mock_redis.setex.assert_called_once_with(
            "tenant_test-key_task:tenant-123", 
            custom_ttl, 
            1
        )

    @patch('core.rag.pipeline.queue.redis_client')
    def test_delete_task_key(self, mock_redis, sample_queue):
        """Test deleting task key."""
        sample_queue.delete_task_key()
        
        mock_redis.delete.assert_called_once_with("tenant_test-key_task:tenant-123")

    @patch('core.rag.pipeline.queue.redis_client')
    def test_push_tasks_string_list(self, mock_redis, sample_queue):
        """Test pushing string tasks directly."""
        tasks = ["task1", "task2", "task3"]
        
        sample_queue.push_tasks(tasks)
        
        mock_redis.lpush.assert_called_once_with(
            "tenant_self_test-key_task_queue:tenant-123",
            "task1", "task2", "task3"
        )

    @patch('core.rag.pipeline.queue.redis_client')
    def test_push_tasks_mixed_types(self, mock_redis, sample_queue):
        """Test pushing mixed string and object tasks."""
        tasks = [
            "string_task",
            {"object_task": "data", "id": 123},
            "another_string"
        ]
        
        sample_queue.push_tasks(tasks)
        
        # Verify lpush was called
        mock_redis.lpush.assert_called_once()
        call_args = mock_redis.lpush.call_args
        
        # Check queue name
        assert call_args[0][0] == "tenant_self_test-key_task_queue:tenant-123"
        
        # Check serialized tasks
        serialized_tasks = call_args[0][1:]
        assert len(serialized_tasks) == 3
        assert serialized_tasks[0] == "string_task"
        assert serialized_tasks[2] == "another_string"
        
        # Check object task is wrapped
        assert serialized_tasks[1].startswith(TASK_WRAPPER_PREFIX)
        wrapper_data = serialized_tasks[1][len(TASK_WRAPPER_PREFIX):]
        parsed_data = json.loads(wrapper_data)
        assert parsed_data == {"object_task": "data", "id": 123}

    @patch('core.rag.pipeline.queue.redis_client')
    def test_push_tasks_empty_list(self, mock_redis, sample_queue):
        """Test pushing empty task list."""
        sample_queue.push_tasks([])
        
        mock_redis.lpush.assert_called_once_with(
            "tenant_self_test-key_task_queue:tenant-123"
        )

    @patch('core.rag.pipeline.queue.redis_client')
    def test_pull_tasks_default_count(self, mock_redis, sample_queue):
        """Test pulling tasks with default count (1)."""
        mock_redis.rpop.side_effect = ["task1", None]
        
        result = sample_queue.pull_tasks()
        
        assert result == ["task1"]
        assert mock_redis.rpop.call_count == 1

    @patch('core.rag.pipeline.queue.redis_client')
    def test_pull_tasks_custom_count(self, mock_redis, sample_queue):
        """Test pulling tasks with custom count."""
        # First test: pull 3 tasks
        mock_redis.rpop.side_effect = ["task1", "task2", "task3", None]
        
        result = sample_queue.pull_tasks(3)
        
        assert result == ["task1", "task2", "task3"]
        assert mock_redis.rpop.call_count == 3

        # Reset mock for second test
        mock_redis.reset_mock()
        mock_redis.rpop.side_effect = ["task1", "task2", None]
        
        result = sample_queue.pull_tasks(3)
        
        assert result == ["task1", "task2"]
        assert mock_redis.rpop.call_count == 3

    @patch('core.rag.pipeline.queue.redis_client')
    def test_pull_tasks_zero_count(self, mock_redis, sample_queue):
        """Test pulling tasks with zero count returns empty list."""
        result = sample_queue.pull_tasks(0)
        
        assert result == []
        mock_redis.rpop.assert_not_called()

    @patch('core.rag.pipeline.queue.redis_client')
    def test_pull_tasks_negative_count(self, mock_redis, sample_queue):
        """Test pulling tasks with negative count returns empty list."""
        result = sample_queue.pull_tasks(-1)
        
        assert result == []
        mock_redis.rpop.assert_not_called()

    @patch('core.rag.pipeline.queue.redis_client')
    def test_pull_tasks_with_wrapped_objects(self, mock_redis, sample_queue):
        """Test pulling tasks that include wrapped objects."""
        # Create a wrapped task
        wrapper = TaskWrapper({"task_id": 123, "data": "test"})
        wrapped_task = f"{TASK_WRAPPER_PREFIX}{wrapper.serialize()}"
        
        mock_redis.rpop.side_effect = [
            "string_task",
            wrapped_task.encode('utf-8'),  # Simulate bytes from Redis
            None
        ]
        
        result = sample_queue.pull_tasks(2)
        
        assert len(result) == 2
        assert result[0] == "string_task"
        assert result[1] == {"task_id": 123, "data": "test"}

    @patch('core.rag.pipeline.queue.redis_client')
    def test_pull_tasks_with_invalid_wrapped_data(self, mock_redis, sample_queue):
        """Test pulling tasks with invalid wrapped data falls back to string."""
        invalid_wrapped = f"{TASK_WRAPPER_PREFIX}invalid json"
        mock_redis.rpop.side_effect = [invalid_wrapped, None]
        
        result = sample_queue.pull_tasks(1)
        
        assert result == [invalid_wrapped]

    @patch('core.rag.pipeline.queue.redis_client')
    def test_pull_tasks_bytes_decoding(self, mock_redis, sample_queue):
        """Test pulling tasks handles bytes from Redis correctly."""
        mock_redis.rpop.side_effect = [
            b"task1",  # bytes
            "task2",   # string
            None
        ]
        
        result = sample_queue.pull_tasks(2)
        
        assert result == ["task1", "task2"]

    @patch('core.rag.pipeline.queue.redis_client')
    def test_get_next_task_success(self, mock_redis, sample_queue):
        """Test getting next single task."""
        mock_redis.rpop.side_effect = ["task1", None]
        
        result = sample_queue.get_next_task()
        
        assert result == "task1"
        assert mock_redis.rpop.call_count == 1

    @patch('core.rag.pipeline.queue.redis_client')
    def test_get_next_task_empty_queue(self, mock_redis, sample_queue):
        """Test getting next task when queue is empty."""
        mock_redis.rpop.return_value = None
        
        result = sample_queue.get_next_task()
        
        assert result is None
        mock_redis.rpop.assert_called_once()

    def test_tenant_isolation(self):
        """Test that different tenants have isolated queues."""
        queue1 = TenantSelfTaskQueue("tenant-1", "key")
        queue2 = TenantSelfTaskQueue("tenant-2", "key")
        
        assert queue1.queue != queue2.queue
        assert queue1.task_key != queue2.task_key
        assert queue1.queue == "tenant_self_key_task_queue:tenant-1"
        assert queue2.queue == "tenant_self_key_task_queue:tenant-2"

    def test_key_isolation(self):
        """Test that different keys have isolated queues."""
        queue1 = TenantSelfTaskQueue("tenant", "key1")
        queue2 = TenantSelfTaskQueue("tenant", "key2")
        
        assert queue1.queue != queue2.queue
        assert queue1.task_key != queue2.task_key
        assert queue1.queue == "tenant_self_key1_task_queue:tenant"
        assert queue2.queue == "tenant_self_key2_task_queue:tenant"

    @patch('core.rag.pipeline.queue.redis_client')
    def test_complex_object_serialization_roundtrip(self, mock_redis, sample_queue):
        """Test complex object serialization and deserialization roundtrip."""
        complex_task = {
            "id": uuid4().hex,
            "data": {
                "nested": {
                    "deep": [1, 2, 3],
                    "unicode": "测试中文",
                    "special": "!@#$%^&*()"
                }
            },
            "metadata": {
                "created_at": "2024-01-01T00:00:00Z",
                "tags": ["tag1", "tag2", "tag3"]
            }
        }
        
        # Push the complex task
        sample_queue.push_tasks([complex_task])
        
        # Verify it was wrapped
        call_args = mock_redis.lpush.call_args
        wrapped_task = call_args[0][1]
        assert wrapped_task.startswith(TASK_WRAPPER_PREFIX)
        
        # Simulate pulling it back
        mock_redis.rpop.return_value = wrapped_task
        result = sample_queue.pull_tasks(1)
        
        assert len(result) == 1
        assert result[0] == complex_task

    @patch('core.rag.pipeline.queue.redis_client')
    def test_large_task_list_handling(self, mock_redis, sample_queue):
        """Test handling of large task lists."""
        large_task_list = [f"task_{i}" for i in range(1000)]
        
        sample_queue.push_tasks(large_task_list)
        
        # Verify all tasks were pushed
        call_args = mock_redis.lpush.call_args
        assert len(call_args[0]) == 1001  # queue name + 1000 tasks
        assert list(call_args[0][1:]) == large_task_list
