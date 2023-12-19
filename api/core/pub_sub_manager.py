import json
from typing import Union, Generator

from redis.client import PubSub

from core.entities.llm_application_entities import InvokeFrom
from extensions.ext_redis import redis_client
from models.model import Conversation, Message, MessageAgentThought


class PubSubManager:
    def __init__(self, task_id: str, user_id: str, invoke_from: InvokeFrom):
        if not user_id:
            raise ValueError("user is required")

        self._task_id = task_id
        self._user_id = user_id
        self._invoke_from = invoke_from
        self._channel = self._generate_task_channel_key(task_id)
        self._subscribe = None

    def subscribe(self) -> PubSub:
        """
        Subscribe to channel
        :return:
        """
        if self._subscribe:
            return self._subscribe

        user_prefix = 'account' if self._invoke_from in [InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER] else 'end-user'
        redis_client.setex(self._generate_task_belong_cache_key(self._task_id), 1800, f"{user_prefix}-{self._user_id}")

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

        self._publish(conversation, message, content)

    def publish_message_replace(self, conversation: Conversation, message: Message, text: str) -> None:
        content = {
            'event': 'message_replace',
            'data': {
                'task_id': self._task_id,
                'message_id': str(message.id),
                'text': text,
                'mode': conversation.mode,
                'conversation_id': str(conversation.id)
            }
        }

        self._publish(conversation, message, content)

    def publish_message_end(self, conversation: Conversation, message: Message, retriever_resource: list) -> None:
        content = {
            'event': 'message_end',
            'data': {
                'task_id': self._task_id,
                'message_id': message.id,
                'mode': conversation.mode,
                'conversation_id': conversation.id
            }
        }
        if retriever_resource:
            content['data']['retriever_resources'] = retriever_resource

        self._publish(conversation, message, content)

    def publish_agent_thought(self, conversation: Conversation,
                              message: Message,
                              message_agent_thought: MessageAgentThought) -> None:
        content = {
            'event': 'agent_thought',
            'data': {
                'id': message_agent_thought.id,
                'task_id': self._task_id,
                'message_id': message.id,
                'chain_id': message_agent_thought.message_chain_id,
                'position': message_agent_thought.position,
                'thought': message_agent_thought.thought,
                'tool': message_agent_thought.tool,
                'tool_input': message_agent_thought.tool_input,
                'mode': conversation.mode,
                'conversation_id': conversation.id
            }
        }

        self._publish(conversation, message, content)

    # def publish_chain(self, conversation: Conversation, message: Message, message_chain: MessageChain) -> None:
    #     content = {
    #         'event': 'chain',
    #         'data': {
    #             'task_id': self._task_id,
    #             'message_id': message.id,
    #             'chain_id': message_chain.id,
    #             'type': message_chain.type,
    #             'input': json.loads(message_chain.input),
    #             'output': json.loads(message_chain.output),
    #             'mode': conversation.mode,
    #             'conversation_id': conversation.id
    #         }
    #     }
    #
    #     self._publish(conversation, message, content)

    def publish_error(self, conversation: Conversation, message: Message, e) -> None:
        content = {
            'error': type(e).__name__,
            'description': e.description if getattr(e, 'description', None) is not None else str(e)
        }

        self._publish(conversation, message, content)

    def publish_ping(self) -> None:
        """
        Publish Ping
        :return:
        """
        content = {
            'event': 'ping'
        }

        self._publish(content)

    def _publish(self, conversation: Conversation, message: Message, content: dict) -> None:
        redis_client.publish(self._channel, json.dumps(content))

        if self._is_stopped():
            self.publish_message_end(conversation, message, [])
            raise ConversationTaskStoppedException()

    def stop_task(self) -> None:
        """
        Stop task
        :return:
        """
        result = redis_client.get(self._generate_task_belong_cache_key(self._task_id))
        if result is None:
            return

        user_prefix = 'account' if self._invoke_from in [InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER] else 'end-user'
        if result != f"{user_prefix}-{self._user_id}":
            return

        stopped_cache_key = self._generate_stopped_cache_key(self._task_id)
        redis_client.setex(stopped_cache_key, 600, 1)

    def _is_stopped(self) -> bool:
        """
        Check if task is stopped
        :return:
        """
        stopped_cache_key = self._generate_stopped_cache_key(self._task_id)
        return redis_client.get(stopped_cache_key) is not None

    def _generate_task_channel_key(self, task_id: str) -> str:
        """
        Generate publish channel key
        :param task_id: task id
        :return:
        """
        return f"generate_task:{task_id}"

    def _generate_task_belong_cache_key(self, task_id: str) -> str:
        """
        Generate task belong cache key
        :param task_id: task id
        :return:
        """
        return f"generate_task_belong:{task_id}"

    def _generate_stopped_cache_key(self, task_id: str) -> str:
        """
        Generate stopped cache key
        :param task_id: task id
        :return:
        """
        return f"generate_task_stopped:{task_id}"


class ConversationTaskStoppedException(Exception):
    pass
