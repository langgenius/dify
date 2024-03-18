import json
from collections.abc import Generator
from typing import Optional, Union, cast

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.entities.model_entities import ModelStatus
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageRole
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.utils.encoders import jsonable_encoder
from core.prompt.advanced_prompt_transform import AdvancedPromptTransform
from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate
from core.prompt.simple_prompt_transform import ModelMode
from core.prompt.utils.prompt_message_util import PromptMessageUtil
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunResult, NodeType, SystemVariable
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.llm.llm_node import LLMNode
from core.workflow.nodes.question_classifier.entities import QuestionClassifierNodeData
from core.workflow.nodes.question_classifier.template_prompts import (
    QUESTION_CLASSIFIER_ASSISTANT_PROMPT_1,
    QUESTION_CLASSIFIER_ASSISTANT_PROMPT_2,
    QUESTION_CLASSIFIER_COMPLETION_PROMPT,
    QUESTION_CLASSIFIER_SYSTEM_PROMPT,
    QUESTION_CLASSIFIER_USER_PROMPT_1,
    QUESTION_CLASSIFIER_USER_PROMPT_2,
    QUESTION_CLASSIFIER_USER_PROMPT_3,
)
from extensions.ext_database import db
from models.model import Conversation
from models.workflow import WorkflowNodeExecutionStatus


class QuestionClassifierNode(BaseNode):
    _node_data_cls = QuestionClassifierNodeData
    _node_type = NodeType.QUESTION_CLASSIFIER

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        node_data: QuestionClassifierNodeData = cast(self._node_data_cls, self.node_data)
        # extract variables
        query = variable_pool.get_variable_value(variable_selector=node_data.query_variable_selector.value_selector)
        variables = {
            node_data.query_variable_selector.variable: query
        }
        # fetch model config
        model_instance, model_config = self._fetch_model_config(node_data)
        # fetch memory
        memory = self._fetch_memory(node_data, variable_pool, model_instance)
        # fetch prompt messages
        prompt_messages, stop = self._fetch_prompt_messages(
            node_data=node_data,
            context='',
            query=query,
            memory=memory,
            model_config=model_config
        )

        # handle invoke result
        result_text, usage = self._invoke_llm(
            node_data=node_data,
            model_instance=model_instance,
            prompt_messages=prompt_messages,
            stop=stop
        )
        try:
            result_text_json = json.loads(result_text)
            categories = result_text_json.get('categories', [])
            process_data = {
                'model_mode': model_config.mode,
                'prompts': PromptMessageUtil.prompt_messages_to_prompt_for_saving(
                    model_mode=model_config.mode,
                    prompt_messages=prompt_messages
                ),
                'usage': jsonable_encoder(usage),
                'topics': categories[0] if categories else ''
            }
            outputs = {
                'class_name': categories[0] if categories else ''
            }
            classes = node_data.classes
            classes_map = {class_.name: class_.id for class_ in classes}

            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs=variables,
                process_data=process_data,
                outputs=outputs,
                edge_source_handle=classes_map.get(categories[0], None)
            )

        except ValueError as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e)
            )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: BaseNodeData) -> dict[str, list[str]]:
        node_data = node_data
        node_data = cast(cls._node_data_cls, node_data)
        variable_mapping = {node_data.query_variable_selector.variable: node_data.query_variable_selector.value_selector}
        return variable_mapping

    @classmethod
    def get_default_config(cls, filters: Optional[dict] = None) -> dict:
        """
        Get default config of node.
        :param filters: filter by node config parameters.
        :return:
        """
        return {
            "type": "question-classifier",
            "config": {
                "instructions": ""  # TODO
            }
        }

    def _fetch_model_config(self, node_data: QuestionClassifierNodeData) \
            -> tuple[ModelInstance, ModelConfigWithCredentialsEntity]:
        """
        Fetch model config
        :param node_data: node data
        :return:
        """
        model_name = node_data.model.name
        provider_name = node_data.model.provider

        model_manager = ModelManager()
        model_instance = model_manager.get_model_instance(
            tenant_id=self.tenant_id,
            model_type=ModelType.LLM,
            provider=provider_name,
            model=model_name
        )

        provider_model_bundle = model_instance.provider_model_bundle
        model_type_instance = model_instance.model_type_instance
        model_type_instance = cast(LargeLanguageModel, model_type_instance)

        model_credentials = model_instance.credentials

        # check model
        provider_model = provider_model_bundle.configuration.get_provider_model(
            model=model_name,
            model_type=ModelType.LLM
        )

        if provider_model is None:
            raise ValueError(f"Model {model_name} not exist.")

        if provider_model.status == ModelStatus.NO_CONFIGURE:
            raise ProviderTokenNotInitError(f"Model {model_name} credentials is not initialized.")
        elif provider_model.status == ModelStatus.NO_PERMISSION:
            raise ModelCurrentlyNotSupportError(f"Dify Hosted OpenAI {model_name} currently not support.")
        elif provider_model.status == ModelStatus.QUOTA_EXCEEDED:
            raise QuotaExceededError(f"Model provider {provider_name} quota exceeded.")

        # model config
        completion_params = node_data.model.completion_params
        stop = []
        if 'stop' in completion_params:
            stop = completion_params['stop']
            del completion_params['stop']

        # get model mode
        model_mode = node_data.model.mode
        if not model_mode:
            raise ValueError("LLM mode is required.")

        model_schema = model_type_instance.get_model_schema(
            model_name,
            model_credentials
        )

        if not model_schema:
            raise ValueError(f"Model {model_name} not exist.")

        return model_instance, ModelConfigWithCredentialsEntity(
            provider=provider_name,
            model=model_name,
            model_schema=model_schema,
            mode=model_mode,
            provider_model_bundle=provider_model_bundle,
            credentials=model_credentials,
            parameters=completion_params,
            stop=stop,
        )

    def _fetch_memory(self, node_data: QuestionClassifierNodeData,
                      variable_pool: VariablePool,
                      model_instance: ModelInstance) -> Optional[TokenBufferMemory]:
        """
        Fetch memory
        :param node_data: node data
        :param variable_pool: variable pool
        :return:
        """
        if not node_data.memory:
            return None

        # get conversation id
        conversation_id = variable_pool.get_variable_value(['sys', SystemVariable.CONVERSATION])
        if conversation_id is None:
            return None

        # get conversation
        conversation = db.session.query(Conversation).filter(
            Conversation.tenant_id == self.tenant_id,
            Conversation.app_id == self.app_id,
            Conversation.id == conversation_id
        ).first()

        if not conversation:
            return None

        memory = TokenBufferMemory(
            conversation=conversation,
            model_instance=model_instance
        )

        return memory

    def _fetch_prompt_messages(self, node_data: QuestionClassifierNodeData,
                               query: str,
                               context: Optional[str],
                               memory: Optional[TokenBufferMemory],
                               model_config: ModelConfigWithCredentialsEntity) \
            -> tuple[list[PromptMessage], Optional[list[str]]]:
        """
        Fetch prompt messages
        :param node_data: node data
        :param inputs: inputs
        :param files: files
        :param context: context
        :param memory: memory
        :param model_config: model config
        :return:
        """
        prompt_transform = AdvancedPromptTransform()
        prompt_template = self._get_prompt_template(node_data, query)
        prompt_messages = prompt_transform.get_prompt(
            prompt_template=prompt_template,
            inputs={},
            query='',
            files=[],
            context=context,
            memory_config=node_data.memory,
            memory=memory,
            model_config=model_config
        )
        stop = model_config.stop

        return prompt_messages, stop

    def _get_prompt_template(self, node_data: QuestionClassifierNodeData, query: str) \
            -> Union[list[ChatModelMessage], CompletionModelPromptTemplate]:
        model_mode = ModelMode.value_of(node_data.model.mode)
        classes = node_data.classes
        class_names = [class_.name for class_ in classes]
        class_names_str = ','.join(class_names)
        instruction = node_data.instruction if node_data.instruction else ''
        input_text = query

        prompt_messages = []
        if model_mode == ModelMode.CHAT:
            system_prompt_messages = ChatModelMessage(
                role=PromptMessageRole.SYSTEM,
                text=QUESTION_CLASSIFIER_SYSTEM_PROMPT
            )
            prompt_messages.append(system_prompt_messages)
            user_prompt_message_1 = ChatModelMessage(
                role=PromptMessageRole.USER,
                text=QUESTION_CLASSIFIER_USER_PROMPT_1
            )
            prompt_messages.append(user_prompt_message_1)
            assistant_prompt_message_1 = ChatModelMessage(
                role=PromptMessageRole.ASSISTANT,
                text=QUESTION_CLASSIFIER_ASSISTANT_PROMPT_1
            )
            prompt_messages.append(assistant_prompt_message_1)
            user_prompt_message_2 = ChatModelMessage(
                role=PromptMessageRole.USER,
                text=QUESTION_CLASSIFIER_USER_PROMPT_2
            )
            prompt_messages.append(user_prompt_message_2)
            assistant_prompt_message_2 = ChatModelMessage(
                role=PromptMessageRole.ASSISTANT,
                text=QUESTION_CLASSIFIER_ASSISTANT_PROMPT_2
            )
            prompt_messages.append(assistant_prompt_message_2)
            user_prompt_message_3 = ChatModelMessage(
                role=PromptMessageRole.USER,
                text=QUESTION_CLASSIFIER_USER_PROMPT_3.format(input_text=input_text, categories=class_names_str,
                                                              classification_instructions=instruction)
            )
            prompt_messages.append(user_prompt_message_3)
            return prompt_messages
        elif model_mode == ModelMode.COMPLETION:
            prompt_messages.append(CompletionModelPromptTemplate(
                text=QUESTION_CLASSIFIER_COMPLETION_PROMPT.format(input_text=input_text, categories=class_names_str,
                                                                  classification_instructions=instruction)
            ))

            return prompt_messages
        else:
            raise ValueError(f"Model mode {model_mode} not support.")

    def _invoke_llm(self, node_data: QuestionClassifierNodeData,
                    model_instance: ModelInstance,
                    prompt_messages: list[PromptMessage],
                    stop: list[str]) -> tuple[str, LLMUsage]:
        """
        Invoke large language model
        :param node_data: node data
        :param model_instance: model instance
        :param prompt_messages: prompt messages
        :param stop: stop
        :return:
        """
        invoke_result = model_instance.invoke_llm(
            prompt_messages=prompt_messages,
            model_parameters=node_data.model.completion_params,
            stop=stop,
            stream=True,
            user=self.user_id,
        )

        # handle invoke result
        text, usage = self._handle_invoke_result(
            invoke_result=invoke_result
        )

        # deduct quota
        LLMNode.deduct_llm_quota(tenant_id=self.tenant_id, model_instance=model_instance, usage=usage)

        return text, usage

    def _handle_invoke_result(self, invoke_result: Generator) -> tuple[str, LLMUsage]:
        """
        Handle invoke result
        :param invoke_result: invoke result
        :return:
        """
        model = None
        prompt_messages = []
        full_text = ''
        usage = None
        for result in invoke_result:
            text = result.delta.message.content
            full_text += text

            self.publish_text_chunk(text=text, value_selector=[self.node_id, 'text'])

            if not model:
                model = result.model

            if not prompt_messages:
                prompt_messages = result.prompt_messages

            if not usage and result.delta.usage:
                usage = result.delta.usage

        if not usage:
            usage = LLMUsage.empty_usage()

        return full_text, usage
