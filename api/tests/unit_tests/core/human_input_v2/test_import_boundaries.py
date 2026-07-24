"""Architecture tests for the infrastructure-free Human Input v2 domain."""

import ast
from pathlib import Path

from core.human_input_v2.entities import ContactId as LegacyContactId
from core.human_input_v2.shared import ContactId

_DOMAIN_ROOT = Path(__file__).resolve().parents[4] / "core/human_input_v2"
_FORBIDDEN_PREFIXES = ("flask", "controllers", "models", "sqlalchemy")


def test_contact_directory_domain_has_no_transport_or_persistence_imports() -> None:
    violations: list[str] = []
    domain_files = sorted((_DOMAIN_ROOT / "contact_directory").glob("*.py"))

    assert domain_files
    for path in domain_files:
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported_modules = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module is not None:
                imported_modules = [node.module]
            else:
                continue
            for imported_module in imported_modules:
                if imported_module.startswith(_FORBIDDEN_PREFIXES):
                    violations.append(f"{path.name}: {imported_module}")

    assert violations == []


def test_legacy_contact_id_remains_a_string_shaped_transport_identifier() -> None:
    assert LegacyContactId("contact-1") == "contact-1"
    assert ContactId("contact-1").to_primitive() == "contact-1"
