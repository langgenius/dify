from core.workflow.entities.node_entities import NodeType
from core.workflow.nodes.end.entities import EndNodeData, EndStreamParam


class EndStreamGeneratorRouter:
    @classmethod
    def init(
        cls,
        node_id_config_mapping: dict[str, dict],
        reverse_edge_mapping: dict[str, list["GraphEdge"]],  # type: ignore[name-defined]
        node_parallel_mapping: dict[str, str],
    ) -> EndStreamParam:
        """
        Get stream generate routes.
        :return:
        """
        # parse stream output node value selector of end nodes
        end_stream_variable_selectors_mapping: dict[str, list[list[str]]] = {}
        for end_node_id, node_config in node_id_config_mapping.items():
            if node_config.get("data", {}).get("type") != NodeType.END.value:
                continue

            # skip end node in parallel
            if end_node_id in node_parallel_mapping:
                continue

            # get generate route for stream output
            stream_variable_selectors = cls._extract_stream_variable_selector(node_id_config_mapping, node_config)
            end_stream_variable_selectors_mapping[end_node_id] = stream_variable_selectors

        # fetch end dependencies
        end_node_ids = list(end_stream_variable_selectors_mapping.keys())
        end_dependencies = cls._fetch_ends_dependencies(
            end_node_ids=end_node_ids,
            reverse_edge_mapping=reverse_edge_mapping,
            node_id_config_mapping=node_id_config_mapping,
        )

        return EndStreamParam(
            end_stream_variable_selector_mapping=end_stream_variable_selectors_mapping,
            end_dependencies=end_dependencies,
        )

    @classmethod
    def extract_stream_variable_selector_from_node_data(
        cls, node_id_config_mapping: dict[str, dict], node_data: EndNodeData
    ) -> list[list[str]]:
        """
        Extract stream variable selector from node data
        :param node_id_config_mapping: node id config mapping
        :param node_data: node data object
        :return:
        """
        variable_selectors = node_data.outputs

        value_selectors = []
        for variable_selector in variable_selectors:
            if not variable_selector.value_selector:
                continue

            node_id = variable_selector.value_selector[0]
            if node_id != "sys" and node_id in node_id_config_mapping:
                node = node_id_config_mapping[node_id]
                node_type = node.get("data", {}).get("type")
                if (
                    variable_selector.value_selector not in value_selectors
                    and node_type == NodeType.LLM.value
                    and variable_selector.value_selector[1] == "text"
                ):
                    value_selectors.append(variable_selector.value_selector)

        return value_selectors

    @classmethod
    def _extract_stream_variable_selector(
        cls, node_id_config_mapping: dict[str, dict], config: dict
    ) -> list[list[str]]:
        """
        Extract stream variable selector from node config
        :param node_id_config_mapping: node id config mapping
        :param config: node config
        :return:
        """
        node_data = EndNodeData(**config.get("data", {}))
        return cls.extract_stream_variable_selector_from_node_data(node_id_config_mapping, node_data)

    @classmethod
    def _fetch_ends_dependencies(
        cls,
        end_node_ids: list[str],
        reverse_edge_mapping: dict[str, list["GraphEdge"]],  # type: ignore[name-defined]
        node_id_config_mapping: dict[str, dict],
    ) -> dict[str, list[str]]:
        """
        Fetch end dependencies
        :param end_node_ids: end node ids
        :param reverse_edge_mapping: reverse edge mapping
        :param node_id_config_mapping: node id config mapping
        :return:
        """
        end_dependencies: dict[str, list[str]] = {}
        for end_node_id in end_node_ids:
            if end_dependencies.get(end_node_id) is None:
                end_dependencies[end_node_id] = []

            cls._recursive_fetch_end_dependencies(
                current_node_id=end_node_id,
                end_node_id=end_node_id,
                node_id_config_mapping=node_id_config_mapping,
                reverse_edge_mapping=reverse_edge_mapping,
                end_dependencies=end_dependencies,
            )

        return end_dependencies

    @classmethod
    def _recursive_fetch_end_dependencies(
        cls,
        current_node_id: str,
        end_node_id: str,
        node_id_config_mapping: dict[str, dict],
        reverse_edge_mapping: dict[str, list["GraphEdge"]],
        # type: ignore[name-defined]
        end_dependencies: dict[str, list[str]],
    ) -> None:
        """
        Recursive fetch end dependencies
        :param current_node_id: current node id
        :param end_node_id: end node id
        :param node_id_config_mapping: node id config mapping
        :param reverse_edge_mapping: reverse edge mapping
        :param end_dependencies: end dependencies
        :return:
        """
        reverse_edges = reverse_edge_mapping.get(current_node_id, [])
        for edge in reverse_edges:
            source_node_id = edge.source_node_id
            source_node_type = node_id_config_mapping[source_node_id].get("data", {}).get("type")
            if source_node_type in (
                NodeType.IF_ELSE.value,
                NodeType.QUESTION_CLASSIFIER,
            ):
                end_dependencies[end_node_id].append(source_node_id)
            else:
                cls._recursive_fetch_end_dependencies(
                    current_node_id=source_node_id,
                    end_node_id=end_node_id,
                    node_id_config_mapping=node_id_config_mapping,
                    reverse_edge_mapping=reverse_edge_mapping,
                    end_dependencies=end_dependencies,
                )
