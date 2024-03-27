import json
from typing import Optional, Union, cast

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageRole
from core.model_runtime.utils.encoders import jsonable_encoder
from core.prompt.advanced_prompt_transform import AdvancedPromptTransform
from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate
from core.prompt.simple_prompt_transform import ModelMode
from core.prompt.utils.prompt_message_util import PromptMessageUtil
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
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
from models.workflow import WorkflowNodeExecutionStatus


class QuestionClassifierNode(LLMNode):
    _node_data_cls = QuestionClassifierNodeData
    _node_type = NodeType.QUESTION_CLASSIFIER

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        node_data: QuestionClassifierNodeData = cast(self._node_data_cls, self.node_data)
        node_data = cast(QuestionClassifierNodeData, node_data)

        # extract variables
        query = variable_pool.get_variable_value(variable_selector=node_data.query_variable_selector)
        variables = {
            'query': query
        }
        # fetch model config
        model_instance, model_config = self._fetch_model_config(node_data.model)
        # fetch memory
        memory = self._fetch_memory(node_data.memory, variable_pool, model_instance)
        # fetch prompt messages
        prompt_messages, stop = self._fetch_prompt(
            node_data=node_data,
            context='',
            query=query,
            memory=memory,
            model_config=model_config
        )

        # handle invoke result
        result_text, usage = self._invoke_llm(
            node_data_model=node_data.model,
            model_instance=model_instance,
            prompt_messages=prompt_messages,
            stop=stop
        )
        try:
            result_text_json = json.loads(result_text.strip('```JSON\n'))
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
        variable_mapping = {'query': node_data.query_variable_selector}
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
                "instructions": ""
            }
        }

    def _fetch_prompt(self, node_data: QuestionClassifierNodeData,
                      query: str,
                      context: Optional[str],
                      memory: Optional[TokenBufferMemory],
                      model_config: ModelConfigWithCredentialsEntity) \
            -> tuple[list[PromptMessage], Optional[list[str]]]:
        """
        Fetch prompt
        :param node_data: node data
        :param query: inputs
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
            return CompletionModelPromptTemplate(
                text=QUESTION_CLASSIFIER_COMPLETION_PROMPT.format(input_text=input_text, categories=class_names_str,
                                                                  classification_instructions=instruction)
            )

        else:
            raise ValueError(f"Model mode {model_mode} not support.")
