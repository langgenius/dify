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


class AnswerStreamGeneratorRouter:
    @classmethod
    def init(
        cls,
        node_id_config_mapping: dict[str, dict],
        reverse_edge_mapping: dict[str, list["GraphEdge"]],  # type: ignore[name-defined]
    ) -> AnswerStreamGenerateRoute:
        """
        Get stream generate routes.
        :return:
        """
        # parse stream output node value selectors of answer nodes
        answer_generate_route: dict[str, list[GenerateRouteChunk]] = {}
        for answer_node_id, node_config in node_id_config_mapping.items():
            if node_config.get("data", {}).get("type") != NodeType.ANSWER.value:
                continue

            # get generate route for stream output
            generate_route = cls._extract_generate_route_selectors(node_config)
            answer_generate_route[answer_node_id] = generate_route

        # fetch answer dependencies
        answer_node_ids = list(answer_generate_route.keys())
        answer_dependencies = cls._fetch_answers_dependencies(
            answer_node_ids=answer_node_ids,
            reverse_edge_mapping=reverse_edge_mapping,
            node_id_config_mapping=node_id_config_mapping,
        )

        return AnswerStreamGenerateRoute(
            answer_generate_route=answer_generate_route, answer_dependencies=answer_dependencies
        )

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
            variable_selector.variable: variable_selector.value_selector for variable_selector in variable_selectors
        }

        variable_keys = list(value_selector_mapping.keys())

        # format answer template
        template_parser = PromptTemplateParser(template=node_data.answer, with_variable_tmpl=True)
        template_variable_keys = template_parser.variable_keys

        # Take the intersection of variable_keys and template_variable_keys
        variable_keys = list(set(variable_keys) & set(template_variable_keys))

        template = node_data.answer
        for var in variable_keys:
            template = template.replace(f"{{{{{var}}}}}", f"Ω{{{{{var}}}}}Ω")

        generate_routes: list[GenerateRouteChunk] = []
        for part in template.split("Ω"):
            if part:
                if cls._is_variable(part, variable_keys):
                    var_key = part.replace("Ω", "").replace("{{", "").replace("}}", "")
                    value_selector = value_selector_mapping[var_key]
                    generate_routes.append(VarGenerateRouteChunk(value_selector=value_selector))
                else:
                    generate_routes.append(TextGenerateRouteChunk(text=part))

        return generate_routes

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
        cleaned_part = part.replace("{{", "").replace("}}", "")
        return part.startswith("{{") and cleaned_part in variable_keys

    @classmethod
    def _fetch_answers_dependencies(
        cls,
        answer_node_ids: list[str],
        reverse_edge_mapping: dict[str, list["GraphEdge"]],  # type: ignore[name-defined]
        node_id_config_mapping: dict[str, dict],
    ) -> dict[str, list[str]]:
        """
        Fetch answer dependencies
        :param answer_node_ids: answer node ids
        :param reverse_edge_mapping: reverse edge mapping
        :param node_id_config_mapping: node id config mapping
        :return:
        """
        answer_dependencies: dict[str, list[str]] = {}
        for answer_node_id in answer_node_ids:
            if answer_dependencies.get(answer_node_id) is None:
                answer_dependencies[answer_node_id] = []

            cls._recursive_fetch_answer_dependencies(
                current_node_id=answer_node_id,
                answer_node_id=answer_node_id,
                node_id_config_mapping=node_id_config_mapping,
                reverse_edge_mapping=reverse_edge_mapping,
                answer_dependencies=answer_dependencies,
            )

        return answer_dependencies

    @classmethod
    def _recursive_fetch_answer_dependencies(
        cls,
        current_node_id: str,
        answer_node_id: str,
        node_id_config_mapping: dict[str, dict],
        reverse_edge_mapping: dict[str, list["GraphEdge"]],  # type: ignore[name-defined]
        answer_dependencies: dict[str, list[str]],
    ) -> None:
        """
        Recursive fetch answer dependencies
        :param current_node_id: current node id
        :param answer_node_id: answer node id
        :param node_id_config_mapping: node id config mapping
        :param reverse_edge_mapping: reverse edge mapping
        :param answer_dependencies: answer dependencies
        :return:
        """
        reverse_edges = reverse_edge_mapping.get(current_node_id, [])
        for edge in reverse_edges:
            source_node_id = edge.source_node_id
            source_node_type = node_id_config_mapping[source_node_id].get("data", {}).get("type")
            if source_node_type in (
                NodeType.ANSWER.value,
                NodeType.IF_ELSE.value,
                NodeType.QUESTION_CLASSIFIER.value,
            ):
                answer_dependencies[answer_node_id].append(source_node_id)
            else:
                cls._recursive_fetch_answer_dependencies(
                    current_node_id=source_node_id,
                    answer_node_id=answer_node_id,
                    node_id_config_mapping=node_id_config_mapping,
                    reverse_edge_mapping=reverse_edge_mapping,
                    answer_dependencies=answer_dependencies,
                )
