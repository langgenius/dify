"""Source-level ownership contracts for IM Contact synchronization ports."""

from __future__ import annotations

import ast
from pathlib import Path
from typing import get_type_hints

from services.human_input_v2.im_contact_sync import composition, coordinator


def test_contact_sync_adapter_protocol_has_one_owner_and_one_shape() -> None:
    package_root = Path(coordinator.__file__).parent
    definitions: list[tuple[Path, ast.ClassDef]] = []

    for source_path in package_root.glob("*.py"):
        module = ast.parse(source_path.read_text())
        definitions.extend(
            (source_path, node)
            for node in ast.walk(module)
            if isinstance(node, ast.ClassDef) and node.name == "IMContactSyncAdapter"
        )

    assert [(source_path.name, node.name) for source_path, node in definitions] == [
        ("coordinator.py", "IMContactSyncAdapter")
    ]
    method_names = {node.name for node in definitions[0][1].body if isinstance(node, ast.FunctionDef)}
    assert method_names == {"directory", "close"}


def test_composition_and_coordinator_share_the_named_integration_factory_protocol() -> None:
    assert composition.IMIntegrationAdapterFactory is coordinator.IMIntegrationAdapterFactory
    return_type = get_type_hints(coordinator.IMIntegrationAdapterFactory.create_for_integration)["return"]
    assert return_type is coordinator.IMContactSyncAdapter
