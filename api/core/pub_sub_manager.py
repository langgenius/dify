import json
from typing import Union, Generator

from redis.client import PubSub

from core.entities.llm_application_entities import InvokeFrom
from extensions.ext_redis import redis_client
from models.model import Conversation, Message


class PubSubManager:
    def __init__(self, task_id: str, user_id: str, invoke_from: InvokeFrom):
        if not user_id:
            raise ValueError("user is required")

        self._task_id = task_id
        self._user_id = user_id
        self._invoke_from = invoke_from
        self._channel = self._generate_channel_name(task_id, user_id, invoke_from)
        self._stopped_cache_key = self._generate_stopped_cache_key(task_id, user_id, invoke_from)
        self._subscribe = None

    def subscribe(self) -> PubSub:
        """
        Subscribe to channel
        :return:
        """
        if self._subscribe:
            return self._subscribe

        pubsub = redis_client.pubsub()
        pubsub.subscribe(self._channel)

        self._subscribe = pubsub

        return pubsub

    def subscriber_listen(self) -> Generator:
        """
        Listen to channel
        :return:
        """
        if not self._subscribe:
            raise Exception("subscriber is not initialized")

        return self._subscribe.listen()

    def unsubscribe(self) -> None:
        """
        Unsubscribe to channel
        :return:
        """
        if self._subscribe:
            self._subscribe.close()
            self._subscribe = None

    def publish_chunk_message(self, conversation: Conversation, message: Message, chunk_text: str) -> None:
        """
        Publish chunk message to channel

        :param conversation:
        :param message:
        :param chunk_text:
        :return:
        """
        content = {
            'event': 'message',
            'data': {
                'task_id': self._task_id,
                'message_id': str(message.id),
                'text': chunk_text,
                'mode': conversation.mode,
                'conversation_id': str(conversation.id)
            }
        }

        self._publish(content)

    def pub_message_replace(self, text: str):
        content = {
            'event': 'message_replace',
            'data': {
                'task_id': self._task_id,
                'message_id': str(message.id),
                'text': text,
                'mode': self._conversation.mode,
                'conversation_id': str(self._conversation.id)
            }
        }

        redis_client.publish(self._channel, json.dumps(content))

    def publish_message_end(self, retriever_resource: List):
        content = {
            'event': 'message_end',
            'data': {
                'task_id': self._task_id,
                'message_id': self._message.id,
                'mode': self._conversation.mode,
                'conversation_id': self._conversation.id
            }
        }
        if retriever_resource:
            content['data']['retriever_resources'] = retriever_resource
        redis_client.publish(self._channel, json.dumps(content))

        if self._is_stopped():
            self.pub_end()
            raise ConversationTaskStoppedException()

    def _generate_channel_name(self, task_id: str, user_id: str, invoke_from: InvokeFrom):
        """
        Generate publish channel name
        :param task_id: task id
        :param user_id: user id
        :param invoke_from: invoke from
        :return:
        """
        prefix = 'account' if invoke_from in [InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER] else 'end-user'
        return f"generate_result:{prefix}-{user_id}-{task_id}"

    def _publish(self, content: dict) -> None:
        redis_client.publish(self._channel, json.dumps(content))

        if self._is_stopped():
            self._pub_end()
            raise ConversationTaskStoppedException()

    def _generate_stopped_cache_key(self, task_id: str, user_id: str, invoke_from: InvokeFrom):
        """
        Generate stopped cache key
        :param task_id: task id
        :param user_id: user id
        :param invoke_from: invoke from
        :return:
        """
        prefix = 'account' if invoke_from in [InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER] else 'end-user'
        return f"generate_result_stopped:{prefix}-{user_id}-{task_id}"

    def _is_stopped(self):
        return redis_client.get(self._stopped_cache_key) is not None


class ConversationTaskStoppedException(Exception):
    pass
