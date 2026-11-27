from core.dify_builder.models import Graph
from services.dify_builder.effect_disclosure import disclose


def api_graph() -> Graph:
    return {
        "nodes": [
            {
                "id": "api",
                "data": {
                    "type": "tool",
                    "provider_type": "api",
                    "provider_id": "owned-provider",
                    "tool_name": "get_invoice",
                    "tool_parameters": {"amount": {"type": "constant", "value": 5}},
                },
            }
        ],
        "edges": [],
    }


def test_read_shaped_api_name_without_owned_definition_never_runs() -> None:
    effects = disclose(api_graph())
    assert effects.mocked_node_ids({}) == frozenset({"api"})
    assert effects.items[0].tier == "side_effect"
