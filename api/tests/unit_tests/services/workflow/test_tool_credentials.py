from copy import deepcopy

import pytest

from services.workflow.tool_credentials import (
    get_tool_authorization_requirements,
    get_tool_connection_requirements,
    requires_end_user_connections,
)


@pytest.mark.parametrize(
    ("provider", "canonical"),
    [
        ("jina", "langgenius/jina_tool/jina"),
        ("langgenius/jina/jina", "langgenius/jina_tool/jina"),
        ("langgenius/jina_tool/jina", "langgenius/jina_tool/jina"),
        ("vendor/jina/jina", "vendor/jina/jina"),
    ],
)
def test_static_requirements_normalize_aliases_without_rewriting_graph(provider: str, canonical: str) -> None:
    graph = {
        "nodes": [
            {
                "id": "tool",
                "data": {
                    "type": "tool",
                    "provider_id": provider,
                    "tool_name": "read",
                    "credential_source": "end_user",
                    "end_user_auth": {"allowed_credential_types": ["api-key"], "purpose": "Read records"},
                },
            }
        ]
    }
    original = deepcopy(graph)
    assert requires_end_user_connections(graph)
    assert get_tool_connection_requirements(graph)[0].provider == canonical
    assert get_tool_authorization_requirements(graph)[0].provider == canonical
    assert graph == original
