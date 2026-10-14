"""Build two minimal, verified Dify source overlays without starting services.

Run in the pinned Dify API image with no network and a writable output mount.
Only public implementation files are read. Private environment/configuration,
databases and plugin credentials are never loaded.
"""

import argparse
import hashlib
from pathlib import Path

BASELINES = {
    "core/entities/provider_configuration.py":
        "c174ff3023cfe5c08ef85461fef8864c1ee57ae9c82771c82e7dcc44351d988a",
    "core/plugin/impl/model_runtime.py":
        "32810fdfbd5caafb25af8f4fd2e13aeb1c2b7a8ce1113616883f53ebd61607e8",
}

LIST_ANCHOR = """        provider_schema = self._get_provider_schema()

        model_types: list[ModelType] = []"""
LIST_REPLACEMENT = """        provider_schema = self._get_provider_schema()
        # Local compatibility: list and selectors discover the same remote catalog.
        from amdgpucloud_remote import resolve_provider_models, uses_remote_catalog

        if uses_remote_catalog(provider_schema.provider):
            provider_schema = resolve_provider_models(self, provider_schema)

        model_types: list[ModelType] = []"""
SCHEMA_ANCHOR = """    ) -> AIModelEntity | None:
        cache_key = self._get_schema_cache_key("""
SCHEMA_REPLACEMENT = """    ) -> AIModelEntity | None:
        from amdgpucloud_remote import resolve_model_schema, uses_remote_catalog

        if uses_remote_catalog(provider):
            # The remote catalog owns capability revisions; do not reuse the
            # generic one-hour schema cache across catalog/credential updates.
            return resolve_model_schema(self, provider, model_type, model, credentials)
        cache_key = self._get_schema_cache_key("""


def generate(api_root: Path, payload: Path, output: Path) -> dict[str, str]:
    patches = {
        "core/entities/provider_configuration.py": (LIST_ANCHOR, LIST_REPLACEMENT),
        "core/plugin/impl/model_runtime.py": (SCHEMA_ANCHOR, SCHEMA_REPLACEMENT),
    }
    files = {}
    for relative, expected in BASELINES.items():
        source = api_root / relative
        if not source.is_file() or source.is_symlink():
            raise ValueError("Expected regular Dify implementation file is unavailable")
        original = source.read_bytes()
        if hashlib.sha256(original).hexdigest() != expected:
            raise ValueError("Dify source baseline differs; refusing to overwrite unknown implementation")
        text = original.decode("utf-8")
        old, new = patches[relative]
        if text.count(old) != 1:
            raise ValueError("Expected native model assembly anchor is not unique")
        updated = text.replace(old, new, 1)
        compile(updated, relative, "exec")
        files[source.name] = updated.encode("utf-8")
    for name in ("model_catalog.py", "amdgpucloud_remote.py"):
        source = payload / name
        if not source.is_file() or source.is_symlink():
            raise ValueError("Expected regular remote-catalog adapter is unavailable")
        content = source.read_bytes()
        compile(content, name, "exec")
        files[name] = content
    if output.is_symlink():
        raise ValueError("Refusing a symlink overlay output directory")
    output.mkdir(parents=True, exist_ok=True)
    output.chmod(0o755)
    for name, content in files.items():
        target = output / name
        if target.is_symlink():
            raise ValueError("Refusing a symlink overlay output file")
        target.write_bytes(content)
        target.chmod(0o644)
    return {name: hashlib.sha256(content).hexdigest() for name, content in files.items()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-root", type=Path, default=Path("/app/api"))
    parser.add_argument("--payload", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    generate(args.api_root, args.payload, args.output)
    print("PASS: verified public source overlays generated; no service, credential or database changed.")


if __name__ == "__main__":
    main()