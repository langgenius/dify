import logging

from constants.constants import REDIS_MESSAGE_PREFIX
from core.app.entities.queue_entities import QueueAgentMessageEvent, QueueLLMChunkEvent, QueueTextChunkEvent
from extensions.ext_redis import redis_client


class AppGeneratorRedisPublisher:

    def __init__(self):
        self.last_message = None
        self.logger = logging.getLogger(__name__)

    def publish(self, message):
        try:
            if message is None:
                if self.last_message:
                    redis_client.rpush(f"{REDIS_MESSAGE_PREFIX}{self.last_message.message_id}", "None")
                    redis_client.expire(f"{REDIS_MESSAGE_PREFIX}{self.last_message.message_id}", 60)
            if isinstance(message.event, QueueAgentMessageEvent | QueueLLMChunkEvent):
                text = message.event.chunk.delta.message.content
                redis_client.rpush(f"{REDIS_MESSAGE_PREFIX}{message.message_id}", text)
                redis_client.expire(f"{REDIS_MESSAGE_PREFIX}{message.message_id}", 60)
                self.last_message = message
            elif isinstance(message.event, QueueTextChunkEvent):
                text = message.event.text
                redis_client.rpush(f"{REDIS_MESSAGE_PREFIX}{message.message_id}", text)
                redis_client.expire(f"{REDIS_MESSAGE_PREFIX}{message.message_id}", 60)
                self.last_message = message
        except Exception as e:
            self.logger.warning(e)
