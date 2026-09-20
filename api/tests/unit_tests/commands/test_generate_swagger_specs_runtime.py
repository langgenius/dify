"""generate swagger specs runtime tests."""

import os
import subprocess
import sys
from pathlib import Path

from tests.unit_tests.commands._swagger_spec_helpers import _load_generate_swagger_specs_module
from tests.unit_tests.config_override import apply_config_overrides


def test_generate_specs_after_controllers_were_imported_with_swagger_disabled(tmp_path: Path):
    api_dir = Path(__file__).resolve().parents[3]
    script = """
import sys
from pathlib import Path

from controllers.console import api as console_api
from controllers.openapi import api as openapi_api
from controllers.service_api import api as service_api
from controllers.web import api as web_api

apis = (console_api, web_api, service_api, openapi_api)
assert all(api._add_specs is False for api in apis)

from dev.generate_swagger_specs import generate_specs

written_paths = generate_specs(Path(sys.argv[1]))
assert [path.name for path in written_paths] == [
    "console-openapi.json",
    "web-openapi.json",
    "service-openapi.json",
    "openapi-openapi.json",
]
"""
    env = os.environ.copy()
    env["PYTHONPATH"] = str(api_dir)
    env["SWAGGER_UI_ENABLED"] = "false"

    result = subprocess.run(
        [sys.executable, "-c", script, str(tmp_path)],
        cwd=api_dir,
        env=env,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_apply_runtime_defaults_forces_swagger_routes_on(monkeypatch):
    module = _load_generate_swagger_specs_module()
    from configs import dify_config

    monkeypatch.setenv("SWAGGER_UI_ENABLED", "false")
    apply_config_overrides(monkeypatch, SWAGGER_UI_ENABLED=False)

    module.apply_runtime_defaults()

    assert dify_config.SWAGGER_UI_ENABLED is True
