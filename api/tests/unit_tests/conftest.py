import os
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

# Getting the absolute path of the current file's directory
ABS_PATH = os.path.dirname(os.path.abspath(__file__))

# Getting the absolute path of the project's root directory
PROJECT_DIR = os.path.abspath(os.path.join(ABS_PATH, os.pardir, os.pardir))

CACHED_APP = Flask(__name__)

# set global mock for Redis client
redis_mock = MagicMock()
redis_mock.get = MagicMock(return_value=None)
redis_mock.setex = MagicMock()
redis_mock.setnx = MagicMock()
redis_mock.delete = MagicMock()
redis_mock.lock = MagicMock()
redis_mock.exists = MagicMock(return_value=False)
redis_mock.set = MagicMock()
redis_mock.expire = MagicMock()
redis_mock.hgetall = MagicMock(return_value={})
redis_mock.hdel = MagicMock()
redis_mock.incr = MagicMock(return_value=1)

# Add pubsub method mock to prevent hanging threads in BroadcastChannel
mock_pubsub = MagicMock()
mock_pubsub.subscribe = MagicMock()
mock_pubsub.unsubscribe = MagicMock()
mock_pubsub.close = MagicMock()


# Mock get_message to simulate Redis behavior without causing test timeouts
def mock_get_message(ignore_subscribe_messages=True, timeout=0.1):
    """Mock pubsub get_message that simulates Redis behavior without blocking"""
    # Return None to break the loop and prevent infinite threading
    return None


mock_pubsub.get_message = MagicMock(side_effect=mock_get_message)
mock_pubsub.execute_command = MagicMock()


# Create a mock pubsub that prevents thread creation entirely
class NonBlockingPubSubMock:
    def __init__(self):
        self.subscribe = MagicMock()
        self.unsubscribe = MagicMock()
        self.close = MagicMock()
        self.execute_command = MagicMock()
        self.get_message = MagicMock(side_effect=mock_get_message)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass


redis_mock.pubsub = MagicMock(return_value=NonBlockingPubSubMock())

# Add info method mock for version detection
redis_mock.info = MagicMock(return_value={"redis_version": "6.2.0"})

# Add the API directory to Python path to ensure proper imports
import sys

sys.path.insert(0, PROJECT_DIR)

# apply the mock to the Redis client in the Flask app
from extensions import ext_redis

redis_patcher = patch.object(ext_redis, "redis_client", redis_mock)
redis_patcher.start()


@pytest.fixture
def app() -> Flask:
    return CACHED_APP


@pytest.fixture(autouse=True)
def _provide_app_context(app: Flask):
    with app.app_context():
        yield


@pytest.fixture(autouse=True)
def reset_redis_mock():
    """reset the Redis mock before each test"""
    redis_mock.reset_mock()
    redis_mock.get.return_value = None
    redis_mock.setex.return_value = None
    redis_mock.setnx.return_value = None
    redis_mock.delete.return_value = None
    redis_mock.exists.return_value = False
    redis_mock.set.return_value = None
    redis_mock.expire.return_value = None
    redis_mock.hgetall.return_value = {}
    redis_mock.hdel.return_value = None
    redis_mock.incr.return_value = 1

    # Reset pubsub mock methods
    mock_pubsub.reset_mock()
    mock_pubsub.subscribe = MagicMock()
    mock_pubsub.unsubscribe = MagicMock()
    mock_pubsub.close = MagicMock()
    mock_pubsub.get_message = MagicMock(side_effect=mock_get_message)
    mock_pubsub.execute_command = MagicMock()

    # Reset the pubsub mock to use the non-blocking version
    redis_mock.pubsub = MagicMock(return_value=NonBlockingPubSubMock())

    # Force cleanup of any remaining broadcast channel threads
    import threading

    # Find and cleanup any redis-broadcast threads
    for thread in threading.enumerate():
        if thread.name.startswith("redis-broadcast-"):
            try:
                # Wait a bit for thread to finish naturally
                thread.join(timeout=0.1)
            except:
                pass  # Ignore errors during cleanup
