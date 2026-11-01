from collections.abc import Callable

import pytest
from redis import Redis
from redis.crc import key_slot

from extensions.ext_redis import RedisClientWrapper
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.locks import document_index_lock_name


@pytest.mark.parametrize("prefix", ["", "dify", "environment:workspace", "  dify  ", "{shared}:dify", "知识库"])
def test_handoff_marker_shares_physical_lock_slot(config_overrides: Callable[..., None], prefix: str) -> None:
    config_overrides(REDIS_KEY_PREFIX=prefix)
    with Redis() as raw:
        client = RedisClientWrapper()
        client.initialize(raw)
        name = document_index_lock_name("document-1")
        lock = client.lock(name, timeout=600, thread_local=False)
        marker = client.lock(RedisKnowledgeIndexingLock._handoff_owner_name(lock))

        expected_name = f"{prefix.strip()}:{name}" if prefix.strip() else name
        assert lock.name == expected_name
        assert key_slot(lock.name.encode()) == key_slot(marker.name.encode())
        if not prefix:
            assert marker.name == f"{{{name}}}:handoff-owner"
