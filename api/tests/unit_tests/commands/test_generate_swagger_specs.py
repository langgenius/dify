"""generate swagger specs tests."""

import json
from pathlib import Path

from tests.unit_tests.commands._swagger_spec_helpers import _load_generate_swagger_specs_module, _reset_schema_cache


def test_generate_specs_writes_console_web_and_service_openapi_files(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    written_paths = module.generate_specs(tmp_path)

    assert [path.name for path in written_paths] == [
        "console-openapi.json",
        "web-openapi.json",
        "service-openapi.json",
        "openapi-openapi.json",
    ]

    for path in written_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert payload["openapi"] == "3.1.0"
        assert "paths" in payload


def test_generate_specs_match_live_openapi_payloads(tmp_path: Path):
    module = _load_generate_swagger_specs_module()
    app = module.create_spec_app()
    client = app.test_client()
    target_apis = module._target_apis()
    for api in target_apis.values():
        _reset_schema_cache(api)
    live_payloads = {target.filename: client.get(target.route).get_json() for target in module.SPEC_TARGETS}

    # Poison the endpoint cache after reading the live contract. The exporter
    # must independently serialize each API instead of succeeding by reading
    # the same cached payload through the HTTP spec route.
    poison_payload = {"poison": "stale schema cache"}
    for api in target_apis.values():
        api._schema = poison_payload
        api.__dict__["__schema__"] = poison_payload
    try:
        for target in module.SPEC_TARGETS:
            response = client.get(target.route)
            assert response.status_code == 200
            assert response.get_json() == poison_payload
        written_paths = module.generate_specs(tmp_path)
    finally:
        for api in target_apis.values():
            _reset_schema_cache(api)

    assert {path.name for path in written_paths} == set(live_payloads)
    for path in written_paths:
        assert json.loads(path.read_text(encoding="utf-8")) == live_payloads[path.name]


def test_generate_specs_is_idempotent(tmp_path: Path):
    module = _load_generate_swagger_specs_module()

    first_paths = module.generate_specs(tmp_path / "first")
    second_paths = module.generate_specs(tmp_path / "second")

    assert [path.name for path in first_paths] == [path.name for path in second_paths]
    for first_path, second_path in zip(first_paths, second_paths):
        assert first_path.read_text(encoding="utf-8") == second_path.read_text(encoding="utf-8")
