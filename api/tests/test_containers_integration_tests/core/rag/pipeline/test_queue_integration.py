"""
Integration tests for TenantIsolatedTaskQueue using testcontainers.

These tests verify the Redis-based task queue functionality with real Redis instances,
testing tenant isolation, task serialization, and queue operations in a realistic environment.
Includes compatibility tests for migrating from legacy string-only queues.

All tests use generic naming to avoid coupling to specific business implementations.
"""

import time
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

import pytest
from faker import Faker

from core.rag.pipeline.queue import TaskWrapper, TenantIsolatedTaskQueue
from extensions.ext_redis import redis_client
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole


@dataclass
class TestTask:
    """Test task data structure for testing complex object serialization."""

    task_id: str
    tenant_id: str
    data: dict[str, Any]
    metadata: dict[str, Any]


class TestTenantIsolatedTaskQueueIntegration:
    """Integration tests for TenantIsolatedTaskQueue using testcontainers."""

    @pytest.fixture
    def fake(self):
        """Faker instance for generating test data."""
        return Faker()

    @pytest.fixture
    def test_tenant_and_account(self, db_session_with_containers, fake):
        """Create test tenant and account for testing."""
        # Create account
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        # Create tenant
        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        return tenant, account

    @pytest.fixture
    def test_queue(self, test_tenant_and_account):
        """Create a generic test queue for testing."""
        tenant, _ = test_tenant_and_account
        return TenantIsolatedTaskQueue(tenant.id, "test_queue")

    @pytest.fixture
    def secondary_queue(self, test_tenant_and_account):
        """Create a secondary test queue for testing isolation."""
        tenant, _ = test_tenant_and_account
        return TenantIsolatedTaskQueue(tenant.id, "secondary_queue")

    def test_queue_initialization(self, test_tenant_and_account):
        """Test queue initialization with correct key generation."""
        tenant, _ = test_tenant_and_account
        queue = TenantIsolatedTaskQueue(tenant.id, "test-key")

        assert queue._tenant_id == tenant.id
        assert queue._unique_key == "test-key"
        assert queue._queue == f"tenant_self_test-key_task_queue:{tenant.id}"
        assert queue._task_key == f"tenant_test-key_task:{tenant.id}"

    def test_tenant_isolation(self, test_tenant_and_account, db_session_with_containers, fake):
        """Test that different tenants have isolated queues."""
        tenant1, _ = test_tenant_and_account

        # Create second tenant
        tenant2 = Tenant(
            name=fake.company(),
            status="normal",
        )
        db_session_with_containers.add(tenant2)
        db_session_with_containers.commit()

        queue1 = TenantIsolatedTaskQueue(tenant1.id, "same-key")
        queue2 = TenantIsolatedTaskQueue(tenant2.id, "same-key")

        assert queue1._queue != queue2._queue
        assert queue1._task_key != queue2._task_key
        assert queue1._queue == f"tenant_self_same-key_task_queue:{tenant1.id}"
        assert queue2._queue == f"tenant_self_same-key_task_queue:{tenant2.id}"

    def test_key_isolation(self, test_tenant_and_account):
        """Test that different keys have isolated queues."""
        tenant, _ = test_tenant_and_account
        queue1 = TenantIsolatedTaskQueue(tenant.id, "key1")
        queue2 = TenantIsolatedTaskQueue(tenant.id, "key2")

        assert queue1._queue != queue2._queue
        assert queue1._task_key != queue2._task_key
        assert queue1._queue == f"tenant_self_key1_task_queue:{tenant.id}"
        assert queue2._queue == f"tenant_self_key2_task_queue:{tenant.id}"

    def test_task_key_operations(self, test_queue):
        """Test task key operations (get, set, delete)."""
        # Initially no task key should exist
        assert test_queue.get_task_key() is None

        # Set task waiting time with default TTL
        test_queue.set_task_waiting_time()
        task_key = test_queue.get_task_key()
        # Redis returns bytes, convert to string for comparison
        assert task_key in (b"1", "1")

        # Set task waiting time with custom TTL
        custom_ttl = 30
        test_queue.set_task_waiting_time(custom_ttl)
        task_key = test_queue.get_task_key()
        assert task_key in (b"1", "1")

        # Delete task key
        test_queue.delete_task_key()
        assert test_queue.get_task_key() is None

    def test_push_and_pull_string_tasks(self, test_queue):
        """Test pushing and pulling string tasks."""
        tasks = ["task1", "task2", "task3"]

        # Push tasks
        test_queue.push_tasks(tasks)

        # Pull tasks (FIFO order)
        pulled_tasks = test_queue.pull_tasks(3)

        # Should get tasks in FIFO order (lpush + rpop = FIFO)
        assert pulled_tasks == ["task1", "task2", "task3"]

    def test_push_and_pull_multiple_tasks(self, test_queue):
        """Test pushing and pulling multiple tasks at once."""
        tasks = ["task1", "task2", "task3", "task4", "task5"]

        # Push tasks
        test_queue.push_tasks(tasks)

        # Pull multiple tasks
        pulled_tasks = test_queue.pull_tasks(3)
        assert len(pulled_tasks) == 3
        assert pulled_tasks == ["task1", "task2", "task3"]

        # Pull remaining tasks
        remaining_tasks = test_queue.pull_tasks(5)
        assert len(remaining_tasks) == 2
        assert remaining_tasks == ["task4", "task5"]

    def test_push_and_pull_complex_objects(self, test_queue, fake):
        """Test pushing and pulling complex object tasks."""
        # Create complex task objects as dictionaries (not dataclass instances)
        tasks = [
            {
                "task_id": str(uuid4()),
                "tenant_id": test_queue._tenant_id,
                "data": {
                    "file_id": str(uuid4()),
                    "content": fake.text(),
                    "metadata": {"size": fake.random_int(1000, 10000)},
                },
                "metadata": {"created_at": fake.iso8601(), "tags": fake.words(3)},
            },
            {
                "task_id": str(uuid4()),
                "tenant_id": test_queue._tenant_id,
                "data": {
                    "file_id": str(uuid4()),
                    "content": "测试中文内容",
                    "metadata": {"size": fake.random_int(1000, 10000)},
                },
                "metadata": {"created_at": fake.iso8601(), "tags": ["中文", "测试", "emoji🚀"]},
            },
        ]

        # Push complex tasks
        test_queue.push_tasks(tasks)

        # Pull tasks
        pulled_tasks = test_queue.pull_tasks(2)
        assert len(pulled_tasks) == 2

        # Verify deserialized tasks match original (FIFO order)
        for i, pulled_task in enumerate(pulled_tasks):
            original_task = tasks[i]  # FIFO order
            assert isinstance(pulled_task, dict)
            assert pulled_task["task_id"] == original_task["task_id"]
            assert pulled_task["tenant_id"] == original_task["tenant_id"]
            assert pulled_task["data"] == original_task["data"]
            assert pulled_task["metadata"] == original_task["metadata"]

    def test_mixed_task_types(self, test_queue, fake):
        """Test pushing and pulling mixed string and object tasks."""
        string_task = "simple_string_task"
        object_task = {
            "task_id": str(uuid4()),
            "dataset_id": str(uuid4()),
            "document_ids": [str(uuid4()) for _ in range(3)],
        }

        tasks = [string_task, object_task, "another_string"]

        # Push mixed tasks
        test_queue.push_tasks(tasks)

        # Pull all tasks
        pulled_tasks = test_queue.pull_tasks(3)
        assert len(pulled_tasks) == 3

        # Verify types and content
        assert pulled_tasks[0] == string_task
        assert isinstance(pulled_tasks[1], dict)
        assert pulled_tasks[1] == object_task
        assert pulled_tasks[2] == "another_string"

    def test_empty_queue_operations(self, test_queue):
        """Test operations on empty queue."""
        # Pull from empty queue
        tasks = test_queue.pull_tasks(5)
        assert tasks == []

        # Pull zero or negative count
        assert test_queue.pull_tasks(0) == []
        assert test_queue.pull_tasks(-1) == []

    def test_task_ttl_expiration(self, test_queue):
        """Test task key TTL expiration."""
        # Set task with short TTL
        short_ttl = 2
        test_queue.set_task_waiting_time(short_ttl)

        # Verify task key exists
        assert test_queue.get_task_key() == b"1" or test_queue.get_task_key() == "1"

        # Wait for TTL to expire
        time.sleep(short_ttl + 1)

        # Verify task key has expired
        assert test_queue.get_task_key() is None

    def test_large_task_batch(self, test_queue, fake):
        """Test handling large batches of tasks."""
        # Create large batch of tasks
        large_batch = []
        for i in range(100):
            task = {
                "task_id": str(uuid4()),
                "index": i,
                "data": fake.text(max_nb_chars=100),
                "metadata": {"batch_id": str(uuid4())},
            }
            large_batch.append(task)

        # Push large batch
        test_queue.push_tasks(large_batch)

        # Pull all tasks
        pulled_tasks = test_queue.pull_tasks(100)
        assert len(pulled_tasks) == 100

        # Verify all tasks were retrieved correctly (FIFO order)
        for i, task in enumerate(pulled_tasks):
            assert isinstance(task, dict)
            assert task["index"] == i  # FIFO order

    def test_queue_operations_isolation(self, test_tenant_and_account, fake):
        """Test concurrent operations on different queues."""
        tenant, _ = test_tenant_and_account

        # Create multiple queues for the same tenant
        queue1 = TenantIsolatedTaskQueue(tenant.id, "queue1")
        queue2 = TenantIsolatedTaskQueue(tenant.id, "queue2")

        # Push tasks to different queues
        queue1.push_tasks(["task1_queue1", "task2_queue1"])
        queue2.push_tasks(["task1_queue2", "task2_queue2"])

        # Verify queues are isolated
        tasks1 = queue1.pull_tasks(2)
        tasks2 = queue2.pull_tasks(2)

        assert tasks1 == ["task1_queue1", "task2_queue1"]
        assert tasks2 == ["task1_queue2", "task2_queue2"]
        assert tasks1 != tasks2

    def test_task_wrapper_serialization_roundtrip(self, test_queue, fake):
        """Test TaskWrapper serialization and deserialization roundtrip."""
        # Create complex nested data
        complex_data = {
            "id": str(uuid4()),
            "nested": {"deep": {"value": "test", "numbers": [1, 2, 3, 4, 5], "unicode": "测试中文", "emoji": "🚀"}},
            "metadata": {"created_at": fake.iso8601(), "tags": ["tag1", "tag2", "tag3"]},
        }

        # Create wrapper and serialize
        wrapper = TaskWrapper(data=complex_data)
        serialized = wrapper.serialize()

        # Verify serialization
        assert isinstance(serialized, str)
        assert "测试中文" in serialized
        assert "🚀" in serialized

        # Deserialize and verify
        deserialized_wrapper = TaskWrapper.deserialize(serialized)
        assert deserialized_wrapper.data == complex_data

    def test_error_handling_invalid_json(self, test_queue):
        """Test error handling for invalid JSON in wrapped tasks."""
        # Manually create invalid JSON task (not a valid TaskWrapper JSON)
        invalid_json_task = "invalid json data"

        # Push invalid task directly to Redis
        redis_client.lpush(test_queue._queue, invalid_json_task)

        # Pull task - should fall back to string since it's not valid JSON
        task = test_queue.pull_tasks(1)
        assert task[0] == invalid_json_task

    def test_real_world_batch_processing_scenario(self, test_queue, fake):
        """Test realistic batch processing scenario."""
        # Simulate batch processing tasks
        batch_tasks = []
        for i in range(3):
            task = {
                "file_id": str(uuid4()),
                "tenant_id": test_queue._tenant_id,
                "user_id": str(uuid4()),
                "processing_config": {
                    "model": fake.random_element(["model_a", "model_b", "model_c"]),
                    "temperature": fake.random.uniform(0.1, 1.0),
                    "max_tokens": fake.random_int(1000, 4000),
                },
                "metadata": {
                    "source": fake.random_element(["upload", "api", "webhook"]),
                    "priority": fake.random_element(["low", "normal", "high"]),
                },
            }
            batch_tasks.append(task)

        # Push tasks
        test_queue.push_tasks(batch_tasks)

        # Process tasks in batches
        batch_size = 2
        processed_tasks = []

        while True:
            batch = test_queue.pull_tasks(batch_size)
            if not batch:
                break

            processed_tasks.extend(batch)

        # Verify all tasks were processed
        assert len(processed_tasks) == 3

        # Verify task structure
        for task in processed_tasks:
            assert isinstance(task, dict)
            assert "file_id" in task
            assert "tenant_id" in task
            assert "processing_config" in task
            assert "metadata" in task
            assert task["tenant_id"] == test_queue._tenant_id


class TestTenantIsolatedTaskQueueCompatibility:
    """Compatibility tests for migrating from legacy string-only queues."""

    @pytest.fixture
    def fake(self):
        """Faker instance for generating test data."""
        return Faker()

    @pytest.fixture
    def test_tenant_and_account(self, db_session_with_containers, fake):
        """Create test tenant and account for testing."""
        # Create account
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        # Create tenant
        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        return tenant, account

    def test_legacy_string_queue_compatibility(self, test_tenant_and_account, fake):
        """
        Test compatibility with legacy queues containing only string data.

        This simulates the scenario where Redis queues already contain string data
        from the old architecture, and we need to ensure the new code can read them.
        """
        tenant, _ = test_tenant_and_account
        queue = TenantIsolatedTaskQueue(tenant.id, "legacy_queue")

        # Simulate legacy string data in Redis queue (using old format)
        legacy_strings = ["legacy_task_1", "legacy_task_2", "legacy_task_3", "legacy_task_4", "legacy_task_5"]

        # Manually push legacy strings directly to Redis (simulating old system)
        for legacy_string in legacy_strings:
            redis_client.lpush(queue._queue, legacy_string)

        # Verify new code can read legacy string data
        pulled_tasks = queue.pull_tasks(5)
        assert len(pulled_tasks) == 5

        # Verify all tasks are strings (not wrapped)
        for task in pulled_tasks:
            assert isinstance(task, str)
            assert task.startswith("legacy_task_")

        # Verify order (FIFO from Redis list)
        expected_order = ["legacy_task_1", "legacy_task_2", "legacy_task_3", "legacy_task_4", "legacy_task_5"]
        assert pulled_tasks == expected_order

    def test_legacy_queue_migration_scenario(self, test_tenant_and_account, fake):
        """
        Test complete migration scenario from legacy to new system.

        This simulates the real-world scenario where:
        1. Legacy system has string data in Redis
        2. New system starts processing the same queue
        3. Both legacy and new tasks coexist during migration
        4. New system can handle both formats seamlessly
        """
        tenant, _ = test_tenant_and_account
        queue = TenantIsolatedTaskQueue(tenant.id, "migration_queue")

        # Phase 1: Legacy system has data
        legacy_tasks = [f"legacy_resource_{i}" for i in range(1, 6)]
        redis_client.lpush(queue._queue, *legacy_tasks)

        # Phase 2: New system starts processing legacy data
        processed_legacy = []
        while True:
            tasks = queue.pull_tasks(1)
            if not tasks:
                break
            processed_legacy.extend(tasks)

        # Verify legacy data was processed correctly
        assert len(processed_legacy) == 5
        for task in processed_legacy:
            assert isinstance(task, str)
            assert task.startswith("legacy_resource_")

        # Phase 3: New system adds new tasks (mixed types)
        new_string_tasks = ["new_resource_1", "new_resource_2"]
        new_object_tasks = [
            {
                "resource_id": str(uuid4()),
                "tenant_id": tenant.id,
                "processing_type": "new_system",
                "metadata": {"version": "2.0", "features": ["ai", "ml"]},
            },
            {
                "resource_id": str(uuid4()),
                "tenant_id": tenant.id,
                "processing_type": "new_system",
                "metadata": {"version": "2.0", "features": ["ai", "ml"]},
            },
        ]

        # Push new tasks using new system
        queue.push_tasks(new_string_tasks)
        queue.push_tasks(new_object_tasks)

        # Phase 4: Process all new tasks
        processed_new = []
        while True:
            tasks = queue.pull_tasks(1)
            if not tasks:
                break
            processed_new.extend(tasks)

        # Verify new tasks were processed correctly
        assert len(processed_new) == 4

        string_tasks = [task for task in processed_new if isinstance(task, str)]
        object_tasks = [task for task in processed_new if isinstance(task, dict)]

        assert len(string_tasks) == 2
        assert len(object_tasks) == 2

        # Verify string tasks
        for task in string_tasks:
            assert task.startswith("new_resource_")

        # Verify object tasks
        for task in object_tasks:
            assert isinstance(task, dict)
            assert "resource_id" in task
            assert "tenant_id" in task
            assert task["tenant_id"] == tenant.id
            assert task["processing_type"] == "new_system"

    def test_legacy_queue_error_recovery(self, test_tenant_and_account, fake):
        """
        Test error recovery when legacy queue contains malformed data.

        This ensures the new system can gracefully handle corrupted or
        malformed legacy data without crashing.
        """
        tenant, _ = test_tenant_and_account
        queue = TenantIsolatedTaskQueue(tenant.id, "error_recovery_queue")

        # Create mix of valid and malformed legacy data
        mixed_legacy_data = [
            "valid_legacy_task_1",
            "valid_legacy_task_2",
            "malformed_data_string",  # This should be treated as string
            "valid_legacy_task_3",
            "invalid_json_not_taskwrapper_format",  # This should fall back to string (not valid TaskWrapper JSON)
            "valid_legacy_task_4",
        ]

        # Manually push mixed data directly to Redis
        redis_client.lpush(queue._queue, *mixed_legacy_data)

        # Process all tasks
        processed_tasks = []
        while True:
            tasks = queue.pull_tasks(1)
            if not tasks:
                break
            processed_tasks.extend(tasks)

        # Verify all tasks were processed (no crashes)
        assert len(processed_tasks) == 6

        # Verify all tasks are strings (malformed data falls back to string)
        for task in processed_tasks:
            assert isinstance(task, str)

        # Verify valid tasks are preserved
        valid_tasks = [task for task in processed_tasks if task.startswith("valid_legacy_task_")]
        assert len(valid_tasks) == 4

        # Verify malformed data is handled gracefully
        malformed_tasks = [task for task in processed_tasks if not task.startswith("valid_legacy_task_")]
        assert len(malformed_tasks) == 2
        assert "malformed_data_string" in malformed_tasks
        assert "invalid_json_not_taskwrapper_format" in malformed_tasks
