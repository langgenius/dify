import decimal
import json
from typing import Optional, Union

from core.callback_handler.entity.agent_loop import AgentLoop
from core.callback_handler.entity.dataset_query import DatasetQueryObj
from core.callback_handler.entity.llm_message import LLMMessage
from core.callback_handler.entity.chain_result import ChainResult
from core.constant import llm_constant
from core.llm.llm_builder import LLMBuilder
from core.llm.provider.llm_provider_service import LLMProviderService
from core.prompt.prompt_builder import PromptBuilder
from core.prompt.prompt_template import JinjaPromptTemplate
from events.message_event import message_was_created
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import DatasetQuery
from models.model import AppModelConfig, Conversation, Account, Message, EndUser, App, MessageAgentThought, MessageChain
from models.provider import ProviderType, Provider


class ConversationMessageTask:
    def __init__(self, task_id: str, app: App, app_model_config: AppModelConfig, user: Account,
                 inputs: dict, query: str, streaming: bool,
                 conversation: Optional[Conversation] = None, is_override: bool = False):
        self.task_id = task_id

        self.app = app
        self.tenant_id = app.tenant_id
        self.app_model_config = app_model_config
        self.is_override = is_override

        self.user = user
        self.inputs = inputs
        self.query = query
        self.streaming = streaming

        self.conversation = conversation
        self.is_new_conversation = False

        self.message = None

        self.model_dict = self.app_model_config.model_dict
        self.model_name = self.model_dict.get('name')
        self.mode = app.mode

        self.init()

        self._pub_handler = PubHandler(
            user=self.user,
            task_id=self.task_id,
            message=self.message,
            conversation=self.conversation,
            chain_pub=False,  # disabled currently
            agent_thought_pub=False  # disabled currently
        )

    def init(self):
        provider_name = LLMBuilder.get_default_provider(self.app.tenant_id)
        self.model_dict['provider'] = provider_name

        override_model_configs = None
        if self.is_override:
            override_model_configs = {
                "model": self.app_model_config.model_dict,
                "pre_prompt": self.app_model_config.pre_prompt,
                "agent_mode": self.app_model_config.agent_mode_dict,
                "opening_statement": self.app_model_config.opening_statement,
                "suggested_questions": self.app_model_config.suggested_questions_list,
                "suggested_questions_after_answer": self.app_model_config.suggested_questions_after_answer_dict,
                "more_like_this": self.app_model_config.more_like_this_dict,
                "sensitive_word_avoidance": self.app_model_config.sensitive_word_avoidance_dict,
                "user_input_form": self.app_model_config.user_input_form_list,
            }

        introduction = ''
        system_instruction = ''
        system_instruction_tokens = 0
        if self.mode == 'chat':
            introduction = self.app_model_config.opening_statement
            if introduction:
                prompt_template = JinjaPromptTemplate.from_template(template=introduction)
                prompt_inputs = {k: self.inputs[k] for k in prompt_template.input_variables if k in self.inputs}
                try:
                    introduction = prompt_template.format(**prompt_inputs)
                except KeyError:
                    pass

            if self.app_model_config.pre_prompt:
                system_message = PromptBuilder.to_system_message(self.app_model_config.pre_prompt, self.inputs)
                system_instruction = system_message.content
                llm = LLMBuilder.to_llm(self.tenant_id, self.model_name)
                system_instruction_tokens = llm.get_messages_tokens([system_message])

        if not self.conversation:
            self.is_new_conversation = True
            self.conversation = Conversation(
                app_id=self.app_model_config.app_id,
                app_model_config_id=self.app_model_config.id,
                model_provider=self.model_dict.get('provider'),
                model_id=self.model_name,
                override_model_configs=json.dumps(override_model_configs) if override_model_configs else None,
                mode=self.mode,
                name='',
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
            db.session.flush()

        self.message = Message(
            app_id=self.app_model_config.app_id,
            model_provider=self.model_dict.get('provider'),
            model_id=self.model_name,
            override_model_configs=json.dumps(override_model_configs) if override_model_configs else None,
            conversation_id=self.conversation.id,
            inputs=self.inputs,
            query=self.query,
            message="",
            message_tokens=0,
            message_unit_price=0,
            answer="",
            answer_tokens=0,
            answer_unit_price=0,
            provider_response_latency=0,
            total_price=0,
            currency=llm_constant.model_currency,
            from_source=('console' if isinstance(self.user, Account) else 'api'),
            from_end_user_id=(self.user.id if isinstance(self.user, EndUser) else None),
            from_account_id=(self.user.id if isinstance(self.user, Account) else None),
            agent_based=self.app_model_config.agent_mode_dict.get('enabled'),
        )

        db.session.add(self.message)
        db.session.flush()

    def append_message_text(self, text: str):
        self._pub_handler.pub_text(text)

    def save_message(self, llm_message: LLMMessage, by_stopped: bool = False):
        model_name = self.app_model_config.model_dict.get('name')

        message_tokens = llm_message.prompt_tokens
        answer_tokens = llm_message.completion_tokens
        message_unit_price = llm_constant.model_prices[model_name]['prompt']
        answer_unit_price = llm_constant.model_prices[model_name]['completion']

        total_price = self.calc_total_price(message_tokens, message_unit_price, answer_tokens, answer_unit_price)

        self.message.message = llm_message.prompt
        self.message.message_tokens = message_tokens
        self.message.message_unit_price = message_unit_price
        self.message.answer = PromptBuilder.process_template(llm_message.completion.strip()) if llm_message.completion else ''
        self.message.answer_tokens = answer_tokens
        self.message.answer_unit_price = answer_unit_price
        self.message.provider_response_latency = llm_message.latency
        self.message.total_price = total_price

        self.update_provider_quota()

        db.session.commit()

        message_was_created.send(
            self.message,
            conversation=self.conversation,
            is_first_message=self.is_new_conversation
        )

        if not by_stopped:
            self.end()

    def update_provider_quota(self):
        llm_provider_service = LLMProviderService(
            tenant_id=self.app.tenant_id,
            provider_name=self.message.model_provider,
        )

        provider = llm_provider_service.get_provider_db_record()
        if provider and provider.provider_type == ProviderType.SYSTEM.value:
            db.session.query(Provider).filter(
                Provider.tenant_id == self.app.tenant_id,
                Provider.quota_limit > Provider.quota_used
            ).update({'quota_used': Provider.quota_used + 1})

    def init_chain(self, chain_result: ChainResult):
        message_chain = MessageChain(
            message_id=self.message.id,
            type=chain_result.type,
            input=json.dumps(chain_result.prompt),
            output=''
        )

        db.session.add(message_chain)
        db.session.flush()

        return message_chain

    def on_chain_end(self, message_chain: MessageChain, chain_result: ChainResult):
        message_chain.output = json.dumps(chain_result.completion)

        self._pub_handler.pub_chain(message_chain)

    def on_agent_end(self, message_chain: MessageChain, agent_model_name: str,
                     agent_loop: AgentLoop):
        agent_message_unit_price = llm_constant.model_prices[agent_model_name]['prompt']
        agent_answer_unit_price = llm_constant.model_prices[agent_model_name]['completion']

        loop_message_tokens = agent_loop.prompt_tokens
        loop_answer_tokens = agent_loop.completion_tokens

        loop_total_price = self.calc_total_price(
            loop_message_tokens,
            agent_message_unit_price,
            loop_answer_tokens,
            agent_answer_unit_price
        )

        message_agent_loop = MessageAgentThought(
            message_id=self.message.id,
            message_chain_id=message_chain.id,
            position=agent_loop.position,
            thought=agent_loop.thought,
            tool=agent_loop.tool_name,
            tool_input=agent_loop.tool_input,
            observation=agent_loop.tool_output,
            tool_process_data='',  # currently not support
            message=agent_loop.prompt,
            message_token=loop_message_tokens,
            message_unit_price=agent_message_unit_price,
            answer=agent_loop.completion,
            answer_token=loop_answer_tokens,
            answer_unit_price=agent_answer_unit_price,
            latency=agent_loop.latency,
            tokens=agent_loop.prompt_tokens + agent_loop.completion_tokens,
            total_price=loop_total_price,
            currency=llm_constant.model_currency,
            created_by_role=('account' if isinstance(self.user, Account) else 'end_user'),
            created_by=self.user.id
        )

        db.session.add(message_agent_loop)
        db.session.flush()

        self._pub_handler.pub_agent_thought(message_agent_loop)

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

    def calc_total_price(self, message_tokens, message_unit_price, answer_tokens, answer_unit_price):
        message_tokens_per_1k = (decimal.Decimal(message_tokens) / 1000).quantize(decimal.Decimal('0.001'),
                                                                                  rounding=decimal.ROUND_HALF_UP)
        answer_tokens_per_1k = (decimal.Decimal(answer_tokens) / 1000).quantize(decimal.Decimal('0.001'),
                                                                                rounding=decimal.ROUND_HALF_UP)

        total_price = message_tokens_per_1k * message_unit_price + answer_tokens_per_1k * answer_unit_price
        return total_price.quantize(decimal.Decimal('0.0000001'), rounding=decimal.ROUND_HALF_UP)

    def end(self):
        self._pub_handler.pub_end()


class PubHandler:
    def __init__(self, user: Union[Account | EndUser], task_id: str,
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
    def generate_channel_name(cls, user: Union[Account | EndUser], task_id: str):
        if not user:
            raise ValueError("user is required")

        user_str = 'account-' + str(user.id) if isinstance(user, Account) else 'end-user-' + str(user.id)
        return "generate_result:{}-{}".format(user_str, task_id)

    @classmethod
    def generate_stopped_cache_key(cls, user: Union[Account | EndUser], task_id: str):
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
                    'task_id': self._task_id,
                    'message_id': self._message.id,
                    'chain_id': message_agent_thought.message_chain_id,
                    'agent_thought_id': message_agent_thought.id,
                    'position': message_agent_thought.position,
                    'thought': message_agent_thought.thought,
                    'tool': message_agent_thought.tool,
                    'tool_input': message_agent_thought.tool_input,
                    'observation': message_agent_thought.observation,
                    'answer': message_agent_thought.answer,
                    'mode': self._conversation.mode,
                    'conversation_id': self._conversation.id
                }
            }

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
    def pub_error(cls, user: Union[Account | EndUser], task_id: str, e):
        content = {
            'error': type(e).__name__,
            'description': e.description if getattr(e, 'description', None) is not None else str(e)
        }

        channel = cls.generate_channel_name(user, task_id)
        redis_client.publish(channel, json.dumps(content))

    def _is_stopped(self):
        return redis_client.get(self._stopped_cache_key) is not None

    @classmethod
    def stop(cls, user: Union[Account | EndUser], task_id: str):
        stopped_cache_key = cls.generate_stopped_cache_key(user, task_id)
        redis_client.setex(stopped_cache_key, 600, 1)


class ConversationTaskStoppedException(Exception):
    pass
