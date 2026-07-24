"""Architecture tests for the infrastructure-free Human Input v2 domain."""

import ast
import os
import subprocess
import sys
from pathlib import Path

from core.human_input_v2.entities import ContactId as LegacyContactId
from core.human_input_v2.shared import ContactId

_DOMAIN_ROOT = Path(__file__).resolve().parents[4] / "core/human_input_v2"
_FORBIDDEN_PREFIXES = (
    "flask",
    "controllers",
    "models",
    "sqlalchemy",
    "core.model_runtime",
    "core.plugin",
    "dify_plugin",
)


def test_domain_packages_have_no_transport_or_persistence_imports() -> None:
    violations: list[str] = []
    domain_files = sorted((_DOMAIN_ROOT / "contact_directory").glob("*.py"))
    domain_files.extend(sorted((_DOMAIN_ROOT / "im_integration").glob("*.py")))
    approval_files = sorted((_DOMAIN_ROOT / "approval").glob("*.py"))
    domain_files.extend(approval_files)

    assert approval_files, "the approval domain package must exist"
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


def test_approval_package_import_does_not_load_transport_persistence_or_provider_clients() -> None:
    script = f"""
import sys
import core.human_input_v2.approval

forbidden_prefixes = {_FORBIDDEN_PREFIXES!r}
violations = sorted(
    module_name
    for module_name in sys.modules
    if any(
        module_name == prefix or module_name.startswith(f"{{prefix}}.")
        for prefix in forbidden_prefixes
    )
)
if violations:
    raise SystemExit(f"forbidden modules loaded: {{violations}}")
"""
    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=_DOMAIN_ROOT.parents[1],
        check=False,
        capture_output=True,
        env={**os.environ, "PYTHONPATH": str(_DOMAIN_ROOT.parents[1])},
        text=True,
    )

    assert completed.returncode == 0, completed.stderr


def test_legacy_contact_id_remains_a_string_shaped_transport_identifier() -> None:
    assert LegacyContactId("contact-1") == "contact-1"
    assert ContactId("contact-1").to_primitive() == "contact-1"
