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


def test_discovers_tool_nodes_from_exported_workflow_dsl_shape():
    dsl = {
        "workflow": {
            "graph": {
                "nodes": [
                    {
                        "data": {
                            "type": "tool",
                            "provider_type": "api",
                            "provider_id": "api-provider-id",
                            "provider_name": "weather",
                        }
                    },
                    {
                        "data": {
                            "type": "tool",
                            "provider_type": "workflow",
                            "provider_id": "workflow-tool-id",
                            "provider_name": "embedded_workflow",
                        }
                    },
                ]
            }
        }
    }

    dependencies = DependencyDiscoveryService().discover_from_dsl(dsl)

    assert [(item.kind, item.provider_id, item.provider_name) for item in dependencies] == [
        (DependencyKind.API_TOOL, "api-provider-id", "weather"),
        (DependencyKind.WORKFLOW_TOOL, "workflow-tool-id", "embedded_workflow"),
    ]


def test_discovers_agent_tools_from_exported_agent_parameter_shape():
    dsl = {
        "workflow": {
            "graph": {
                "nodes": [
                    {
                        "data": {
                            "type": "agent",
                            "agent_parameters": {
                                "tools": {
                                    "value": [
                                        {
                                            "provider_type": "api",
                                            "provider_id": "api-provider-id",
                                            "provider_name": "weather",
                                        }
                                    ]
                                }
                            },
                        }
                    }
                ]
            }
        }
    }

    dependencies = DependencyDiscoveryService().discover_from_dsl(dsl)

    assert [(item.kind, item.provider_id, item.provider_name) for item in dependencies] == [
        (DependencyKind.API_TOOL, "api-provider-id", "weather"),
    ]
