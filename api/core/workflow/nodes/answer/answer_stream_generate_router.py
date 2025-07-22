from core.prompt.utils.prompt_template_parser import PromptTemplateParser
from core.workflow.nodes.answer.entities import (
    AnswerNodeData,
    AnswerStreamGenerateRoute,
    GenerateRouteChunk,
    TextGenerateRouteChunk,
    VarGenerateRouteChunk,
)
from core.workflow.nodes.enums import NodeType
from core.workflow.utils.variable_template_parser import VariableTemplateParser


class AnswerStreamGeneratorRouter:
    @classmethod
    def init(
        cls,
        node_id_config_mapping: dict[str, dict],
        reverse_edge_mapping: dict[str, list["GraphEdge"]],  # type: ignore[name-defined]
    ) -> AnswerStreamGenerateRoute:
        """
        Initializes the stream generation routes for all Answer nodes in the workflow.
        This method performs a static analysis of the graph to parse the answer templates.
        The old logic for pre-calculating static dependencies has been deprecated and removed,
        as the decision logic is now handled dynamically at runtime by the AnswerStreamProcessor.
        """
        # parse stream output node value selectors of answer nodes
        answer_generate_route: dict[str, list[GenerateRouteChunk]] = {}
        for answer_node_id, node_config in node_id_config_mapping.items():
            if node_config.get("data", {}).get("type") != NodeType.ANSWER.value:
                continue

            # get generate route for stream output
            generate_route = cls._extract_generate_route_selectors(node_config)
            answer_generate_route[answer_node_id] = generate_route

        return AnswerStreamGenerateRoute(
            answer_generate_route=answer_generate_route
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
        # Trim whitespace from the answer template to prevent parsing issues with leading/trailing spaces.
        if node_data.answer:
            node_data.answer = node_data.answer.strip()
        return cls.extract_generate_route_from_node_data(node_data)

    @classmethod
    def _is_variable(cls, part, variable_keys):
        cleaned_part = part.replace("{{", "").replace("}}", "")
        return part.startswith("{{") and cleaned_part in variable_keys
