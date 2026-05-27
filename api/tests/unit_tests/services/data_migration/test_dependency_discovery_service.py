from services.data_migration.dependency_discovery_service import DependencyDiscoveryService
from services.data_migration.entities import DependencyKind


def test_discovers_and_deduplicates_standalone_tool_nodes():
    graph = {
        "graph": {
            "nodes": [
                {"data": {"type": "tool", "provider_type": "api", "provider_id": "weather"}},
                {"data": {"type": "tool", "provider_type": "api", "provider_id": "weather"}},
                {"data": {"type": "tool", "provider_type": "workflow", "provider_id": "wf-tool-1"}},
                {"data": {"type": "tool", "provider_type": "builtin", "provider_id": "google_search"}},
            ]
        }
    }

    dependencies = DependencyDiscoveryService().discover_from_dsl(graph)

    assert [(item.kind, item.provider_id) for item in dependencies] == [
        (DependencyKind.API_TOOL, "weather"),
        (DependencyKind.WORKFLOW_TOOL, "wf-tool-1"),
        (DependencyKind.BUILTIN_OR_PLUGIN_TOOL, "google_search"),
    ]


def test_discovers_agent_node_tools():
    graph = {
        "graph": {
            "nodes": [
                {
                    "data": {
                        "type": "agent",
                        "tools": [
                            {"provider_type": "mcp", "provider_id": "mcp-1"},
                            {"provider_type": "api", "provider_id": "api-1"},
                        ],
                    }
                }
            ]
        }
    }

    dependencies = DependencyDiscoveryService().discover_from_dsl(graph)

    assert [(item.kind, item.provider_id) for item in dependencies] == [
        (DependencyKind.MCP_TOOL, "mcp-1"),
        (DependencyKind.API_TOOL, "api-1"),
    ]
