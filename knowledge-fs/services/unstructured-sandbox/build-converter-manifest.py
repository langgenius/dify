"""Build-time contract gate; resolve original executables before adding wrappers to PATH."""

import json
import os
import shutil
from importlib.metadata import version
from pathlib import Path

from prepline_general.api.app import app

assert version("unstructured") == "0.22.18"
assert not app.router.on_startup and not app.router.on_shutdown
assert type(app.router.lifespan_context).__name__ == "_DefaultLifespan"
commands = {kind: shutil.which(kind) for kind in ("soffice", "pandoc")}
assert all(
    path and Path(path).is_absolute() and os.access(path, os.X_OK)
    for path in commands.values()
)
Path("/opt/kfs-sandbox/converters.json").write_text(json.dumps(commands))
