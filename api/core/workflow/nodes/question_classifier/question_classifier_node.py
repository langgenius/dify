import json
import logging
from typing import Optional, Union, cast

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.model_runtime.entities.message_entities import PromptMessage, PromptMessageRole
from core.model_runtime.entities.model_entities import ModelPropertyKey
from core.model_runtime.utils.encoders import jsonable_encoder
from core.prompt.advanced_prompt_transform import AdvancedPromptTransform
from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate
from core.prompt.simple_prompt_transform import ModelMode
from core.prompt.utils.prompt_message_util import PromptMessageUtil
from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunMetadataKey, NodeRunResult, NodeType
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
from core.workflow.utils.variable_template_parser import VariableTemplateParser
from libs.json_in_md_parser import parse_and_check_json_markdown
from models.workflow import WorkflowNodeExecutionStatus


class QuestionClassifierNode(LLMNode):
    _node_data_cls = QuestionClassifierNodeData
    node_type = NodeType.QUESTION_CLASSIFIER

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        node_data: QuestionClassifierNodeData = cast(self._node_data_cls, self.node_data)
        node_data = cast(QuestionClassifierNodeData, node_data)

        # extract variables
        variable = variable_pool.get(node_data.query_variable_selector)
        query = variable.value if variable else None
        variables = {
            'query': query
        }
        # fetch model config
        model_instance, model_config = self._fetch_model_config(node_data.model)
        # fetch memory
        memory = self._fetch_memory(node_data.memory, variable_pool, model_instance)
        # fetch instruction
        instruction = self._format_instruction(node_data.instruction, variable_pool) if node_data.instruction else ''
        node_data.instruction = instruction
        # fetch prompt messages
        prompt_messages, stop = self._fetch_prompt(
            node_data=node_data,
            context='',
            query=query,
            memory=memory,
            model_config=model_config
        )

        # handle invoke result
        result_text, usage, finish_reason = self._invoke_llm(
            node_data_model=node_data.model,
            model_instance=model_instance,
            prompt_messages=prompt_messages,
            stop=stop
        )
        category_name = node_data.classes[0].name
        category_id = node_data.classes[0].id
        try:
            result_text_json = parse_and_check_json_markdown(result_text, [])
            # result_text_json = json.loads(result_text.strip('```JSON\n'))
            if 'category_name' in result_text_json and 'category_id' in result_text_json:
                category_id_result = result_text_json['category_id']
                classes = node_data.classes
                classes_map = {class_.id: class_.name for class_ in classes}
                category_ids = [_class.id for _class in classes]
                if category_id_result in category_ids:
                    category_name = classes_map[category_id_result]
                    category_id = category_id_result

        except Exception:
            logging.error(f"Failed to parse result text: {result_text}")
        try:
            process_data = {
                'model_mode': model_config.mode,
                'prompts': PromptMessageUtil.prompt_messages_to_prompt_for_saving(
                    model_mode=model_config.mode,
                    prompt_messages=prompt_messages
                ),
                'usage': jsonable_encoder(usage),
                'finish_reason': finish_reason
            }
            outputs = {
                'class_name': category_name
            }

            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs=variables,
                process_data=process_data,
                outputs=outputs,
                edge_source_handle=category_id,
                metadata={
                    NodeRunMetadataKey.TOTAL_TOKENS: usage.total_tokens,
                    NodeRunMetadataKey.TOTAL_PRICE: usage.total_price,
                    NodeRunMetadataKey.CURRENCY: usage.currency
                }
            )

        except ValueError as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e),
                metadata={
                    NodeRunMetadataKey.TOTAL_TOKENS: usage.total_tokens,
                    NodeRunMetadataKey.TOTAL_PRICE: usage.total_price,
                    NodeRunMetadataKey.CURRENCY: usage.currency
                }
            )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: BaseNodeData) -> dict[str, list[str]]:
        node_data = node_data
        node_data = cast(cls._node_data_cls, node_data)
        variable_mapping = {'query': node_data.query_variable_selector}
        variable_selectors = []
        if node_data.instruction:
            variable_template_parser = VariableTemplateParser(template=node_data.instruction)
            variable_selectors.extend(variable_template_parser.extract_variable_selectors())
        for variable_selector in variable_selectors:
            variable_mapping[variable_selector.variable] = variable_selector.value_selector
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
        prompt_transform = AdvancedPromptTransform(with_variable_tmpl=True)
        rest_token = self._calculate_rest_token(node_data, query, model_config, context)
        prompt_template = self._get_prompt_template(node_data, query, memory, rest_token)
        prompt_messages = prompt_transform.get_prompt(
            prompt_template=prompt_template,
            inputs={},
            query='',
            files=[],
            context=context,
            memory_config=node_data.memory,
            memory=None,
            model_config=model_config
        )
        stop = model_config.stop

        return prompt_messages, stop

    def _calculate_rest_token(self, node_data: QuestionClassifierNodeData, query: str,
                              model_config: ModelConfigWithCredentialsEntity,
                              context: Optional[str]) -> int:
        prompt_transform = AdvancedPromptTransform(with_variable_tmpl=True)
        prompt_template = self._get_prompt_template(node_data, query, None, 2000)
        prompt_messages = prompt_transform.get_prompt(
            prompt_template=prompt_template,
            inputs={},
            query='',
            files=[],
            context=context,
            memory_config=node_data.memory,
            memory=None,
            model_config=model_config
        )
        rest_tokens = 2000

        model_context_tokens = model_config.model_schema.model_properties.get(ModelPropertyKey.CONTEXT_SIZE)
        if model_context_tokens:
            model_instance = ModelInstance(
                provider_model_bundle=model_config.provider_model_bundle,
                model=model_config.model
            )

            curr_message_tokens = model_instance.get_llm_num_tokens(
                prompt_messages
            )

            max_tokens = 0
            for parameter_rule in model_config.model_schema.parameter_rules:
                if (parameter_rule.name == 'max_tokens'
                        or (parameter_rule.use_template and parameter_rule.use_template == 'max_tokens')):
                    max_tokens = (model_config.parameters.get(parameter_rule.name)
                                  or model_config.parameters.get(parameter_rule.use_template)) or 0

            rest_tokens = model_context_tokens - max_tokens - curr_message_tokens
            rest_tokens = max(rest_tokens, 0)

        return rest_tokens

    def _get_prompt_template(self, node_data: QuestionClassifierNodeData, query: str,
                             memory: Optional[TokenBufferMemory],
                             max_token_limit: int = 2000) \
            -> Union[list[ChatModelMessage], CompletionModelPromptTemplate]:
        model_mode = ModelMode.value_of(node_data.model.mode)
        classes = node_data.classes
        categories = []
        for class_ in classes:
            category = {
                'category_id': class_.id,
                'category_name': class_.name
            }
            categories.append(category)
        instruction = node_data.instruction if node_data.instruction else ''
        input_text = query
        memory_str = ''
        if memory:
            memory_str = memory.get_history_prompt_text(max_token_limit=max_token_limit,
                                                        message_limit=node_data.memory.window.size)
        prompt_messages = []
        if model_mode == ModelMode.CHAT:
            system_prompt_messages = ChatModelMessage(
                role=PromptMessageRole.SYSTEM,
                text=QUESTION_CLASSIFIER_SYSTEM_PROMPT.format(histories=memory_str)
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
                text=QUESTION_CLASSIFIER_USER_PROMPT_3.format(input_text=input_text,
                                                              categories=json.dumps(categories, ensure_ascii=False),
                                                              classification_instructions=instruction)
            )
            prompt_messages.append(user_prompt_message_3)
            return prompt_messages
        elif model_mode == ModelMode.COMPLETION:
            return CompletionModelPromptTemplate(
                text=QUESTION_CLASSIFIER_COMPLETION_PROMPT.format(histories=memory_str,
                                                                  input_text=input_text,
                                                                  categories=json.dumps(categories),
                                                                  classification_instructions=instruction,
                                                                  ensure_ascii=False)
            )

        else:
            raise ValueError(f"Model mode {model_mode} not support.")

    def _format_instruction(self, instruction: str, variable_pool: VariablePool) -> str:
        inputs = {}

        variable_selectors = []
        variable_template_parser = VariableTemplateParser(template=instruction)
        variable_selectors.extend(variable_template_parser.extract_variable_selectors())
        for variable_selector in variable_selectors:
            variable = variable_pool.get(variable_selector.value_selector)
            variable_value = variable.value if variable else None
            if variable_value is None:
                raise ValueError(f'Variable {variable_selector.variable} not found')

            inputs[variable_selector.variable] = variable_value

        prompt_template = PromptTemplateParser(template=instruction, with_variable_tmpl=True)
        prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}

        instruction = prompt_template.format(
            prompt_inputs
        )
        return instruction
