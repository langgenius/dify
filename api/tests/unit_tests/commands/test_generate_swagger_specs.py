"""Unit tests for the standalone Swagger export helper."""

import importlib.util
import json
import sys
from pathlib import Path


def _load_generate_swagger_specs_module():
    api_dir = Path(__file__).resolve().parents[3]
    script_path = api_dir / "dev" / "generate_swagger_specs.py"

    spec = importlib.util.spec_from_file_location("generate_swagger_specs", script_path)
    assert spec
    assert spec.loader

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)  # type: ignore[attr-defined]
    return module


def test_generate_specs_writes_console_web_and_service_swagger_files(tmp_path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)

    assert [path.name for path in written_paths] == [
        "console-swagger.json",
        "web-swagger.json",
        "service-swagger.json",
    ]

    for path in written_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert payload["swagger"] == "2.0"
        assert "paths" in payload
