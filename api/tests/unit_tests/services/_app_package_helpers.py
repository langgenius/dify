"""Shared builders for the adjacent test modules."""

import hashlib
import io
import zipfile

import yaml


def _archive(dsl: str, **manifest_overrides: object) -> io.BytesIO:
    payload = dsl.encode()
    manifest = {
        "format": "dify.app",
        "format_version": 1,
        "apps": [{"path": "app.yaml", "size": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}],
        **manifest_overrides,
    }
    source = io.BytesIO()
    with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.yaml", yaml.safe_dump(manifest))
        archive.writestr("app.yaml", payload)
    source.seek(0)
    return source
