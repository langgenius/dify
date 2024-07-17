from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from core.workflow.entities.node_entities import NodeType
from core.workflow.nodes.answer.entities import (
    AnswerNodeData,
    AnswerStreamGenerateRoute,
    GenerateRouteChunk,
    TextGenerateRouteChunk,
    VarGenerateRouteChunk,
)
from core.workflow.utils.variable_template_parser import VariableTemplateParser


class AnswerStreamOutputManager:

    @classmethod
    def init_stream_generate_routes(cls,
                                    node_id_config_mapping: dict[str, dict],
                                    edge_mapping: dict[str, list["GraphEdge"]]  # type: ignore[name-defined]
                                    ) -> dict[str, AnswerStreamGenerateRoute]:
        """
        Get stream generate routes.
        :return:
        """
        # parse stream output node value selectors of answer nodes
        stream_generate_routes = {}
        for node_id, node_config in node_id_config_mapping.items():
            if not node_config.get('data', {}).get('type') == NodeType.ANSWER.value:
                continue

            # get generate route for stream output
            generate_route = cls._extract_generate_route_selectors(node_config)
            streaming_node_ids = cls._get_streaming_node_ids(
                target_node_id=node_id,
                node_id_config_mapping=node_id_config_mapping,
                edge_mapping=edge_mapping
            )

            if not streaming_node_ids:
                continue

            for streaming_node_id in streaming_node_ids:
                stream_generate_routes[streaming_node_id] = AnswerStreamGenerateRoute(
                    answer_node_id=node_id,
                    generate_route=generate_route
                )

        return stream_generate_routes

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

        generate_routes: list[GenerateRouteChunk] = []
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
    def _get_streaming_node_ids(cls,
                                target_node_id: str,
                                node_id_config_mapping: dict[str, dict],
                                edge_mapping: dict[str, list["GraphEdge"]]) -> list[str]:  # type: ignore[name-defined]
        """
        Get answer stream node IDs.
        :param target_node_id: target node ID
        :return:
        """
        # fetch all ingoing edges from source node
        ingoing_graph_edges = []
        for graph_edges in edge_mapping.values():
            for graph_edge in graph_edges:
                if graph_edge.target_node_id == target_node_id:
                    ingoing_graph_edges.append(graph_edge)

        if not ingoing_graph_edges:
            return []

        streaming_node_ids = []
        for ingoing_graph_edge in ingoing_graph_edges:
            source_node_id = ingoing_graph_edge.source_node_id
            source_node = node_id_config_mapping.get(source_node_id)
            if not source_node:
                continue

            node_type = source_node.get('data', {}).get('type')

            if node_type in [
                NodeType.ANSWER.value,
                NodeType.IF_ELSE.value,
                NodeType.QUESTION_CLASSIFIER.value,
                NodeType.ITERATION.value,
                NodeType.LOOP.value
            ]:
                # Current node (answer nodes / multi-branch nodes / iteration nodes) cannot be stream node.
                streaming_node_ids.append(target_node_id)
            elif node_type == NodeType.START.value:
                # Current node is START node, can be stream node.
                streaming_node_ids.append(source_node_id)
            else:
                # Find the stream node forward.
                sub_streaming_node_ids = cls._get_streaming_node_ids(
                    target_node_id=source_node_id,
                    node_id_config_mapping=node_id_config_mapping,
                    edge_mapping=edge_mapping
                )

                if sub_streaming_node_ids:
                    streaming_node_ids.extend(sub_streaming_node_ids)

        return streaming_node_ids

    @classmethod
    def _extract_generate_route_selectors(cls, config: dict) -> list[GenerateRouteChunk]:
        """
        Extract generate route selectors
        :param config: node config
        :return:
        """
        node_data = AnswerNodeData(**config.get("data", {}))
        return cls.extract_generate_route_from_node_data(node_data)

    @classmethod
    def _is_variable(cls, part, variable_keys):
        cleaned_part = part.replace('{{', '').replace('}}', '')
        return part.startswith('{{') and cleaned_part in variable_keys
