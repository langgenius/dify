import json
import time
from typing import Optional, Union, List

from core.callback_handler.entity.agent_loop import AgentLoop
from core.callback_handler.entity.dataset_query import DatasetQueryObj
from core.callback_handler.entity.llm_message import LLMMessage
from core.callback_handler.entity.chain_result import ChainResult
from core.file.file_obj import FileObj
from core.model_providers.model_factory import ModelFactory
from core.model_providers.models.entity.message import to_prompt_messages, MessageType, PromptMessageFile
from core.model_providers.models.llm.base import BaseLLM
from core.prompt.prompt_builder import PromptBuilder
from core.prompt.prompt_template import PromptTemplateParser
from events.message_event import message_was_created
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import DatasetQuery
from models.model import AppModelConfig, Conversation, Account, Message, EndUser, App, MessageAgentThought, \
    MessageChain, DatasetRetrieverResource, MessageFile


class ConversationMessageTask:
    def __init__(self, task_id: str, app: App, app_model_config: AppModelConfig, user: Account,
                 inputs: dict, query: str, files: List[FileObj], streaming: bool,
                 model_instance: BaseLLM, conversation: Optional[Conversation] = None, is_override: bool = False,
                 auto_generate_name: bool = True):
        self.start_at = time.perf_counter()

        self.task_id = task_id

        self.app = app
        self.tenant_id = app.tenant_id
        self.app_model_config = app_model_config
        self.is_override = is_override

        self.user = user
        self.inputs = inputs
        self.query = query
        self.files = files
        self.streaming = streaming

        self.conversation = conversation
        self.is_new_conversation = False

        self.model_instance = model_instance

        self.message = None

        self.retriever_resource = None
        self.auto_generate_name = auto_generate_name

        self.model_dict = self.app_model_config.model_dict
        self.provider_name = self.model_dict.get('provider')
        self.model_name = self.model_dict.get('name')
        self.mode = app.mode

        self.init()

        self._pub_handler = PubHandler(
            user=self.user,
            task_id=self.task_id,
            message=self.message,
            conversation=self.conversation,
            chain_pub=False,  # disabled currently
            agent_thought_pub=True
        )

    def init(self):

        override_model_configs = None
        if self.is_override:
            override_model_configs = self.app_model_config.to_dict()

        introduction = ''
        system_instruction = ''
        system_instruction_tokens = 0
        if self.mode == 'chat':
            introduction = self.app_model_config.opening_statement
            if introduction:
                prompt_template = PromptTemplateParser(template=introduction)
                prompt_inputs = {k: self.inputs[k] for k in prompt_template.variable_keys if k in self.inputs}
                try:
                    introduction = prompt_template.format(prompt_inputs)
                except KeyError:
                    pass

            if self.app_model_config.pre_prompt:
                system_message = PromptBuilder.to_system_message(self.app_model_config.pre_prompt, self.inputs)
                system_instruction = system_message.content
                model_instance = ModelFactory.get_text_generation_model(
                    tenant_id=self.tenant_id,
                    model_provider_name=self.provider_name,
                    model_name=self.model_name
                )
                system_instruction_tokens = model_instance.get_num_tokens(to_prompt_messages([system_message]))

        if not self.conversation:
            self.is_new_conversation = True
            self.conversation = Conversation(
                app_id=self.app.id,
                app_model_config_id=self.app_model_config.id,
                model_provider=self.provider_name,
                model_id=self.model_name,
                override_model_configs=json.dumps(override_model_configs) if override_model_configs else None,
                mode=self.mode,
                name='New conversation',
                inputs=self.inputs,
                introduction=introduction,
                system_instruction=system_instruction,
                system_instruction_tokens=system_instruction_tokens,
                status='normal',
                from_source=('console' if isinstance(self.user, Account) else 'api'),
                from_end_user_id=(self.user.id if isinstance(self.user, EndUser) else None),
                from_account_id=(self.user.id if isinstance(self.user, Account) else None),
            )

            db.session.add(self.conversation)
            db.session.commit()

        self.message = Message(
            app_id=self.app.id,
            model_provider=self.provider_name,
            model_id=self.model_name,
            override_model_configs=json.dumps(override_model_configs) if override_model_configs else None,
            conversation_id=self.conversation.id,
            inputs=self.inputs,
            query=self.query,
            message="",
            message_tokens=0,
            message_unit_price=0,
            message_price_unit=0,
            answer="",
            answer_tokens=0,
            answer_unit_price=0,
            answer_price_unit=0,
            provider_response_latency=0,
            total_price=0,
            currency=self.model_instance.get_currency(),
            from_source=('console' if isinstance(self.user, Account) else 'api'),
            from_end_user_id=(self.user.id if isinstance(self.user, EndUser) else None),
            from_account_id=(self.user.id if isinstance(self.user, Account) else None),
            agent_based=self.app_model_config.agent_mode_dict.get('enabled'),
        )

        db.session.add(self.message)
        db.session.commit()

        for file in self.files:
            message_file = MessageFile(
                message_id=self.message.id,
                type=file.type.value,
                transfer_method=file.transfer_method.value,
                url=file.url,
                upload_file_id=file.upload_file_id,
                created_by_role=('account' if isinstance(self.user, Account) else 'end_user'),
                created_by=self.user.id
            )
            db.session.add(message_file)
            db.session.commit()

    def append_message_text(self, text: str):
        if text is not None:
            self._pub_handler.pub_text(text)

    def save_message(self, llm_message: LLMMessage, by_stopped: bool = False):
        message_tokens = llm_message.prompt_tokens
        answer_tokens = llm_message.completion_tokens

        message_unit_price = self.model_instance.get_tokens_unit_price(MessageType.USER)
        message_price_unit = self.model_instance.get_price_unit(MessageType.USER)
        answer_unit_price = self.model_instance.get_tokens_unit_price(MessageType.ASSISTANT)
        answer_price_unit = self.model_instance.get_price_unit(MessageType.ASSISTANT)

        message_total_price = self.model_instance.calc_tokens_price(message_tokens, MessageType.USER)
        answer_total_price = self.model_instance.calc_tokens_price(answer_tokens, MessageType.ASSISTANT)
        total_price = message_total_price + answer_total_price

        self.message.message = llm_message.prompt
        self.message.message_tokens = message_tokens
        self.message.message_unit_price = message_unit_price
        self.message.message_price_unit = message_price_unit
        self.message.answer = PromptTemplateParser.remove_template_variables(
            llm_message.completion.strip()) if llm_message.completion else ''
        self.message.answer_tokens = answer_tokens
        self.message.answer_unit_price = answer_unit_price
        self.message.answer_price_unit = answer_price_unit
        self.message.provider_response_latency = time.perf_counter() - self.start_at
        self.message.total_price = total_price

        db.session.commit()

        message_was_created.send(
            self.message,
            conversation=self.conversation,
            is_first_message=self.is_new_conversation,
            auto_generate_name=self.auto_generate_name
        )

        if not by_stopped:
            self.end()

    def init_chain(self, chain_result: ChainResult):
        message_chain = MessageChain(
            message_id=self.message.id,
            type=chain_result.type,
            input=json.dumps(chain_result.prompt),
            output=''
        )

        db.session.add(message_chain)
        db.session.commit()

        return message_chain

    def on_chain_end(self, message_chain: MessageChain, chain_result: ChainResult):
        message_chain.output = json.dumps(chain_result.completion)
        db.session.commit()

        self._pub_handler.pub_chain(message_chain)

    def on_agent_start(self, message_chain: MessageChain, agent_loop: AgentLoop) -> MessageAgentThought:
        message_agent_thought = MessageAgentThought(
            message_id=self.message.id,
            message_chain_id=message_chain.id,
            position=agent_loop.position,
            thought=agent_loop.thought,
            tool=agent_loop.tool_name,
            tool_input=agent_loop.tool_input,
            message=agent_loop.prompt,
            message_price_unit=0,
            answer=agent_loop.completion,
            answer_price_unit=0,
            created_by_role=('account' if isinstance(self.user, Account) else 'end_user'),
            created_by=self.user.id
        )

        db.session.add(message_agent_thought)
        db.session.commit()

        self._pub_handler.pub_agent_thought(message_agent_thought)

        return message_agent_thought

    def on_agent_end(self, message_agent_thought: MessageAgentThought, agent_model_instance: BaseLLM,
                     agent_loop: AgentLoop):
        agent_message_unit_price = agent_model_instance.get_tokens_unit_price(MessageType.USER)
        agent_message_price_unit = agent_model_instance.get_price_unit(MessageType.USER)
        agent_answer_unit_price = agent_model_instance.get_tokens_unit_price(MessageType.ASSISTANT)
        agent_answer_price_unit = agent_model_instance.get_price_unit(MessageType.ASSISTANT)

        loop_message_tokens = agent_loop.prompt_tokens
        loop_answer_tokens = agent_loop.completion_tokens

        loop_message_total_price = agent_model_instance.calc_tokens_price(loop_message_tokens, MessageType.USER)
        loop_answer_total_price = agent_model_instance.calc_tokens_price(loop_answer_tokens, MessageType.ASSISTANT)
        loop_total_price = loop_message_total_price + loop_answer_total_price

        message_agent_thought.observation = agent_loop.tool_output
        message_agent_thought.tool_process_data = ''  # currently not support
        message_agent_thought.message_token = loop_message_tokens
        message_agent_thought.message_unit_price = agent_message_unit_price
        message_agent_thought.message_price_unit = agent_message_price_unit
        message_agent_thought.answer_token = loop_answer_tokens
        message_agent_thought.answer_unit_price = agent_answer_unit_price
        message_agent_thought.answer_price_unit = agent_answer_price_unit
        message_agent_thought.latency = agent_loop.latency
        message_agent_thought.tokens = agent_loop.prompt_tokens + agent_loop.completion_tokens
        message_agent_thought.total_price = loop_total_price
        message_agent_thought.currency = agent_model_instance.get_currency()
        db.session.commit()

    def on_dataset_query_end(self, dataset_query_obj: DatasetQueryObj):
        dataset_query = DatasetQuery(
            dataset_id=dataset_query_obj.dataset_id,
            content=dataset_query_obj.query,
            source='app',
            source_app_id=self.app.id,
            created_by_role=('account' if isinstance(self.user, Account) else 'end_user'),
            created_by=self.user.id
        )

        db.session.add(dataset_query)
        db.session.commit()

    def on_dataset_query_finish(self, resource: List):
        if resource and len(resource) > 0:
            for item in resource:
                dataset_retriever_resource = DatasetRetrieverResource(
                    message_id=self.message.id,
                    position=item.get('position'),
                    dataset_id=item.get('dataset_id'),
                    dataset_name=item.get('dataset_name'),
                    document_id=item.get('document_id'),
                    document_name=item.get('document_name'),
                    data_source_type=item.get('data_source_type'),
                    segment_id=item.get('segment_id'),
                    score=item.get('score') if 'score' in item else None,
                    hit_count=item.get('hit_count') if 'hit_count' else None,
                    word_count=item.get('word_count') if 'word_count' in item else None,
                    segment_position=item.get('segment_position') if 'segment_position' in item else None,
                    index_node_hash=item.get('index_node_hash') if 'index_node_hash' in item else None,
                    content=item.get('content'),
                    retriever_from=item.get('retriever_from'),
                    created_by=self.user.id
                )
                db.session.add(dataset_retriever_resource)
                db.session.commit()
            self.retriever_resource = resource

    def on_message_replace(self, text: str):
        if text is not None:
            self._pub_handler.pub_message_replace(text)

    def message_end(self):
        self._pub_handler.pub_message_end(self.retriever_resource)

    def end(self):
        self._pub_handler.pub_message_end(self.retriever_resource)
        self._pub_handler.pub_end()


class PubHandler:
    def __init__(self, user: Union[Account, EndUser], task_id: str,
                 message: Message, conversation: Conversation,
                 chain_pub: bool = False, agent_thought_pub: bool = False):
        self._channel = PubHandler.generate_channel_name(user, task_id)
        self._stopped_cache_key = PubHandler.generate_stopped_cache_key(user, task_id)

        self._task_id = task_id
        self._message = message
        self._conversation = conversation
        self._chain_pub = chain_pub
        self._agent_thought_pub = agent_thought_pub

    @classmethod
    def generate_channel_name(cls, user: Union[Account, EndUser], task_id: str):
        if not user:
            raise ValueError("user is required")

        user_str = 'account-' + str(user.id) if isinstance(user, Account) else 'end-user-' + str(user.id)
        return "generate_result:{}-{}".format(user_str, task_id)

    @classmethod
    def generate_stopped_cache_key(cls, user: Union[Account, EndUser], task_id: str):
        user_str = 'account-' + str(user.id) if isinstance(user, Account) else 'end-user-' + str(user.id)
        return "generate_result_stopped:{}-{}".format(user_str, task_id)

    def pub_text(self, text: str):
        content = {
            'event': 'message',
            'data': {
                'task_id': self._task_id,
                'message_id': str(self._message.id),
                'text': text,
                'mode': self._conversation.mode,
                'conversation_id': str(self._conversation.id)
            }
        }

        redis_client.publish(self._channel, json.dumps(content))

        if self._is_stopped():
            self.pub_end()
            raise ConversationTaskStoppedException()

    def pub_message_replace(self, text: str):
        content = {
            'event': 'message_replace',
            'data': {
                'task_id': self._task_id,
                'message_id': str(self._message.id),
                'text': text,
                'mode': self._conversation.mode,
                'conversation_id': str(self._conversation.id)
            }
        }

        redis_client.publish(self._channel, json.dumps(content))

        if self._is_stopped():
            self.pub_end()
            raise ConversationTaskStoppedException()

    def pub_chain(self, message_chain: MessageChain):
        if self._chain_pub:
            content = {
                'event': 'chain',
                'data': {
                    'task_id': self._task_id,
                    'message_id': self._message.id,
                    'chain_id': message_chain.id,
                    'type': message_chain.type,
                    'input': json.loads(message_chain.input),
                    'output': json.loads(message_chain.output),
                    'mode': self._conversation.mode,
                    'conversation_id': self._conversation.id
                }
            }

            redis_client.publish(self._channel, json.dumps(content))

        if self._is_stopped():
            self.pub_end()
            raise ConversationTaskStoppedException()

    def pub_agent_thought(self, message_agent_thought: MessageAgentThought):
        if self._agent_thought_pub:
            content = {
                'event': 'agent_thought',
                'data': {
                    'id': message_agent_thought.id,
                    'task_id': self._task_id,
                    'message_id': self._message.id,
                    'chain_id': message_agent_thought.message_chain_id,
                    'position': message_agent_thought.position,
                    'thought': message_agent_thought.thought,
                    'tool': message_agent_thought.tool,
                    'tool_input': message_agent_thought.tool_input,
                    'mode': self._conversation.mode,
                    'conversation_id': self._conversation.id
                }
            }

            redis_client.publish(self._channel, json.dumps(content))

        if self._is_stopped():
            self.pub_end()
            raise ConversationTaskStoppedException()

    def pub_message_end(self, retriever_resource: List):
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

    def pub_end(self):
        content = {
            'event': 'end',
        }

        redis_client.publish(self._channel, json.dumps(content))

    @classmethod
    def pub_error(cls, user: Union[Account, EndUser], task_id: str, e):
        content = {
            'error': type(e).__name__,
            'description': e.description if getattr(e, 'description', None) is not None else str(e)
        }

        channel = cls.generate_channel_name(user, task_id)
        redis_client.publish(channel, json.dumps(content))

    def _is_stopped(self):
        return redis_client.get(self._stopped_cache_key) is not None

    @classmethod
    def ping(cls, user: Union[Account, EndUser], task_id: str):
        content = {
            'event': 'ping'
        }

        channel = cls.generate_channel_name(user, task_id)
        redis_client.publish(channel, json.dumps(content))

    @classmethod
    def stop(cls, user: Union[Account, EndUser], task_id: str):
        stopped_cache_key = cls.generate_stopped_cache_key(user, task_id)
        redis_client.setex(stopped_cache_key, 600, 1)


class ConversationTaskStoppedException(Exception):
    pass


class ConversationTaskInterruptException(Exception):
    pass
