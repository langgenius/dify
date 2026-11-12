"""Fail the QA image build if additive BYOA installation changes live dependencies.

Snapshot runs before any overlay copy. Validation runs in a fresh interpreter
after the ten explicit local installations. Neither command calls a vendor,
database, broker, nor the application factory.
"""

import hashlib
import importlib
import importlib.util
import json
import os
import re
import sys
from importlib import metadata
from pathlib import Path

ROOT = Path("/app/byoa-dev-integration")
PACKAGES = (
    "dify_trace_aliyun",
    "dify_trace_arize_phoenix",
    "dify_trace_langfuse",
    "dify_trace_langsmith",
    "dify_trace_mlflow",
    "dify_trace_opik",
    "dify_trace_tencent",
    "dify_trace_weave",
)


def versions() -> dict[str, str]:
    """Read installed distribution versions without resolving dependencies."""
    return {
        re.sub(r"[-_.]+", "-", item.name).lower(): item.version
        for item in metadata.distributions()
    }


def package_root(name: str) -> Path:
    """Locate a concrete package without replacing modules or constructors."""
    specification = importlib.util.find_spec(name)
    if specification is None or specification.origin is None:
        raise RuntimeError(f"Required installed package is missing: {name}")
    return Path(specification.origin).resolve().parent


def snapshot() -> None:
    """Persist actual base versions and Native provider implementation bytes."""
    ROOT.mkdir(parents=True, exist_ok=True)
    current = versions()
    if "dify-trace-sdk" in current or "dify-api" in current:
        raise RuntimeError(
            "Expected the inspected a69 base without the SDK or a dify-api distribution"
        )
    native = {
        name: {
            str(path.relative_to(package_root(name))): hashlib.sha256(
                path.read_bytes()
            ).hexdigest()
            for path in package_root(name).rglob("*.py")
        }
        for name in PACKAGES
    }
    original_entrypoint = hashlib.sha256(
        Path("/entrypoint.sh").read_bytes()
    ).hexdigest()
    api = {}
    for directory, children, files in os.walk("/app/api"):
        children[:] = [
            name for name in children if name not in {".venv", "storage", "__pycache__"}
        ]
        for name in files:
            path = Path(directory) / name
            if path.suffix == ".py":
                api[str(path.relative_to("/app/api"))] = hashlib.sha256(
                    path.read_bytes()
                ).hexdigest()
    (ROOT / "base-environment.json").write_text(
        json.dumps(
            {
                "versions": current,
                "native": native,
                "entrypoint_sha256": original_entrypoint,
                "api": api,
            },
            indent=2,
        )
    )


def validate() -> None:
    """Prove unchanged base dependencies, real editable imports and installed entrypoints."""
    before = json.loads((ROOT / "base-environment.json").read_text())
    manifest = json.loads((ROOT / "overlay-manifest.json").read_text())
    allowed = {
        item["path"].removeprefix("api/")
        for item in manifest["files"]
        if item["path"].startswith("api/")
    }
    retained = 0
    for relative, digest in before["api"].items():
        if relative not in allowed:
            path = Path("/app/api") / relative
            if (
                not path.is_file()
                or hashlib.sha256(path.read_bytes()).hexdigest() != digest
            ):
                raise RuntimeError(
                    f"API source outside the additive overlay changed: {relative}"
                )
            retained += 1
    if (
        hashlib.sha256(Path("/entrypoint.sh").read_bytes()).hexdigest()
        != before["entrypoint_sha256"]
    ):
        raise RuntimeError("The inherited API/worker/Beat entrypoint changed")
    after = versions()
    changed = {
        name: (version, after.get(name))
        for name, version in before["versions"].items()
        if after.get(name) != version
    }
    added = set(after) - set(before["versions"])
    if changed or added != {"dify-trace-sdk"}:
        raise RuntimeError(
            f"Base dependency drift: changed={changed}; added={sorted(added)}"
        )
    preserved = 0
    for name, files in before["native"].items():
        root = package_root(name)
        for relative, digest in files.items():
            path = root / relative
            if (
                not path.is_file()
                or hashlib.sha256(path.read_bytes()).hexdigest() != digest
            ):
                raise RuntimeError(
                    f"Native provider implementation changed: {name}/{relative}"
                )
            preserved += 1
        importlib.import_module(f"{name}.agent_trace")
    graphon = package_root("graphon")
    if not graphon.is_relative_to(Path("/app/packages/graphon")):
        raise RuntimeError("Graphon is not loaded from the managed source")
    from graphon.entities.pause_reason import ExternalWaitReason
    from services.tracing.registry import EntryPointTraceProviderCatalog

    catalog = EntryPointTraceProviderCatalog()
    providers = (
        "aliyun",
        "arize",
        "phoenix",
        "langfuse",
        "langsmith",
        "mlflow",
        "databricks",
        "opik",
        "tencent",
        "weave",
    )
    for name in providers:
        implementation = catalog.resolve(name)
        if (
            implementation.id != name
            or not implementation.config_model.__module__.endswith(".byoa_config")
        ):
            raise RuntimeError(f"Invalid installed SDK provider entrypoint: {name}")
    for item in manifest["files"]:
        path = Path("/app") / item["path"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            raise RuntimeError(f"Overlay content mismatch: {item['path']}")
    receipt = {
        "base_revision": manifest["base_revision"],
        "source_revision": manifest["source_revision"],
        "base_distribution_count": len(before["versions"]),
        "base_versions_changed": changed,
        "added_distributions": sorted(added),
        "preserved_native_python_files": preserved,
        "native_provider_imports": len(PACKAGES),
        "sdk_entrypoints": list(providers),
        "inherited_entrypoint_unchanged": True,
        "preserved_api_python_files_outside_overlay": retained,
        "graphon_source": str(graphon),
        "external_wait_reason": ExternalWaitReason.__name__,
        "network_calls": 0,
        "business_invocations": 0,
    }
    (ROOT / "build-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in {"snapshot", "validate"}:
        raise SystemExit("Usage: validate_environment.py snapshot|validate")
    if sys.argv[1] == "snapshot":
        snapshot()
    else:
        validate()
