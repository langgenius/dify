from typing import cast

from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.answer.entities import (
    AnswerNodeData,
    GenerateRouteChunk,
    TextGenerateRouteChunk,
    VarGenerateRouteChunk,
)
from core.workflow.nodes.base_node import BaseNode
from core.workflow.utils.variable_template_parser import VariableTemplateParser
from models.workflow import WorkflowNodeExecutionStatus


class AnswerNode(BaseNode):
    _node_data_cls = AnswerNodeData
    _node_type: NodeType = NodeType.ANSWER

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        """
        Run node
        :param variable_pool: variable pool
        :return:
        """
        node_data = self.node_data
        node_data = cast(AnswerNodeData, node_data)

        # generate routes
        generate_routes = self.extract_generate_route_from_node_data(node_data)

        answer = ''
        for part in generate_routes:
            if part.type == "var":
                part = cast(VarGenerateRouteChunk, part)
                value_selector = part.value_selector
                value = variable_pool.get(value_selector)
                if value:
                    answer += value.markdown
            else:
                part = cast(TextGenerateRouteChunk, part)
                answer += part.text

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs={
                "answer": answer
            }
        )

    @classmethod
    def extract_generate_route_selectors(cls, config: dict) -> list[GenerateRouteChunk]:
        """
        Extract generate route selectors
        :param config: node config
        :return:
        """
        node_data = cls._node_data_cls(**config.get("data", {}))
        node_data = cast(AnswerNodeData, node_data)

        return cls.extract_generate_route_from_node_data(node_data)

    @classmethod
    def extract_generate_route_from_node_data(cls, node_data: AnswerNodeData) -> list[GenerateRouteChunk]:
        """
        Extract generate route from node data
        :param node_data: node data object
        :return:
        """
        variable_template_parser = VariableTemplateParser(template=node_data.answer)
        variable_selectors = variable_template_parser.extract_variable_selectors()

        value_selector_mapping = {
            variable_selector.variable: variable_selector.value_selector
            for variable_selector in variable_selectors
        }

        variable_keys = list(value_selector_mapping.keys())

        # format answer template
        template_parser = PromptTemplateParser(template=node_data.answer, with_variable_tmpl=True)
        template_variable_keys = template_parser.variable_keys

        # Take the intersection of variable_keys and template_variable_keys
        variable_keys = list(set(variable_keys) & set(template_variable_keys))

        template = node_data.answer
        for var in variable_keys:
            template = template.replace(f'{{{{{var}}}}}', f'Ω{{{{{var}}}}}Ω')

        generate_routes = []
        for part in template.split('Ω'):
            if part:
                if cls._is_variable(part, variable_keys):
                    var_key = part.replace('Ω', '').replace('{{', '').replace('}}', '')
                    value_selector = value_selector_mapping[var_key]
                    generate_routes.append(VarGenerateRouteChunk(
                        value_selector=value_selector
                    ))
                else:
                    generate_routes.append(TextGenerateRouteChunk(
                        text=part
                    ))

        return generate_routes

    @classmethod
    def _is_variable(cls, part, variable_keys):
        cleaned_part = part.replace('{{', '').replace('}}', '')
        return part.startswith('{{') and cleaned_part in variable_keys

    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: BaseNodeData) -> dict[str, list[str]]:
        """
        Extract variable selector to variable mapping
        :param node_data: node data
        :return:
        """
        node_data = node_data
        node_data = cast(AnswerNodeData, node_data)

        variable_template_parser = VariableTemplateParser(template=node_data.answer)
        variable_selectors = variable_template_parser.extract_variable_selectors()

        variable_mapping = {}
        for variable_selector in variable_selectors:
            variable_mapping[variable_selector.variable] = variable_selector.value_selector

        return variable_mapping
