import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from configs.tokener_mapping_registry import (
    MAX_MAPPING_REGISTRY_BYTES,
    TokenerMappingConfigurationError,
    merge_mapping_registry_file,
)
from services.model_billing_mapping_service import mappings_for_revision


def test_registry_file_appends_without_changing_inputs_or_environment(tmp_path: Path) -> None:
    source = tmp_path / "registry.json"
    original = '[{"revision":"new","label":"模型"}]'
    source.write_text(original, encoding="utf-8")
    environment = dict(os.environ)

    result = merge_mapping_registry_file('[{"revision":"old"}]', str(source))

    assert json.loads(result) == [{"revision": "old"}, {"revision": "new", "label": "模型"}]
    assert source.read_text(encoding="utf-8") == original
    assert dict(os.environ) == environment


def test_registry_file_can_exceed_linux_single_environment_value_limit(tmp_path: Path) -> None:
    source = tmp_path / "registry.json"
    records = [{"model": "test-model", "schema": "x" * (256 * 1024)}]
    source.write_text(json.dumps(records), encoding="utf-8")

    assert json.loads(merge_mapping_registry_file("[]", str(source))) == records


def test_normal_process_config_startup_loads_large_file_without_exporting_effective_registry(tmp_path: Path) -> None:
    source = tmp_path / "registry.json"
    source.write_text(json.dumps([{"schema": "x" * (256 * 1024)}]), encoding="utf-8")
    inline = '[{"revision":"inline"}]'
    environment = dict(os.environ) | {
        "TOKENER_LEGACY_MODEL_MAPPING_JSON": inline,
        "TOKENER_LEGACY_MODEL_MAPPING_FILE": str(source),
        "REMOTE_SETTINGS_SOURCE_NAME": "",
    }
    script = """
import json
import os
from configs import dify_config
records = json.loads(dify_config.TOKENER_LEGACY_MODEL_MAPPING_JSON)
print(json.dumps({"count": len(records), "size": len(records[1]["schema"]),
                  "inline_env": os.environ["TOKENER_LEGACY_MODEL_MAPPING_JSON"]}))
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).parents[3],
        env=environment,
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )

    assert json.loads(result.stdout) == {"count": 2, "size": 256 * 1024, "inline_env": inline}


@pytest.mark.parametrize(
    "content",
    [
        b"",
        b"{}",
        b"null",
        b"[1]",
        b"[{}] trailing",
        b"\xff",
        b'[{"x":1,"x":2}]',
        b'[{"x":NaN}]',
        b'[{"x":Infinity}]',
        b'[{"x":1e999}]',
        b"[" * 2000 + b"]" * 2000,
    ],
)
def test_registry_file_rejects_invalid_json_without_echoing_contents(tmp_path: Path, content: bytes) -> None:
    source = tmp_path / "private-file-name.json"
    source.write_bytes(content)

    with pytest.raises(TokenerMappingConfigurationError) as error:
        merge_mapping_registry_file("[]", str(source))

    assert str(source) not in str(error.value)
    assert "private-file-name" not in str(error.value)
    assert error.value.__cause__ is None


def test_registry_file_rejects_relative_missing_directory_symlink_and_fifo(tmp_path: Path) -> None:
    target = tmp_path / "target.json"
    target.write_text("[]", encoding="utf-8")
    symlink = tmp_path / "link.json"
    symlink.symlink_to(target)
    fifo = tmp_path / "pipe.json"
    os.mkfifo(fifo)
    for source in ("relative.json", str(tmp_path / "missing.json"), str(tmp_path), str(symlink), str(fifo)):
        with pytest.raises(TokenerMappingConfigurationError):
            merge_mapping_registry_file("[]", source)


def test_registry_file_checks_raw_and_merged_byte_limits(tmp_path: Path) -> None:
    source = tmp_path / "registry.json"
    source.write_bytes(b"[]" + b" " * (MAX_MAPPING_REGISTRY_BYTES - 2))
    assert merge_mapping_registry_file("[]", str(source)) == "[]"

    source.write_bytes(b"[]" + b" " * (MAX_MAPPING_REGISTRY_BYTES - 1))
    with pytest.raises(TokenerMappingConfigurationError, match="4 MiB"):
        merge_mapping_registry_file("[]", str(source))

    # Each input fits, but UTF-8 combined output exceeds the limit.
    payload = json.dumps([{"schema": "模型" * (MAX_MAPPING_REGISTRY_BYTES // 12)}], ensure_ascii=False)
    source.write_text(payload, encoding="utf-8")
    with pytest.raises(TokenerMappingConfigurationError, match="4 MiB"):
        merge_mapping_registry_file(payload, str(source))


def test_registry_file_does_not_deduplicate_or_validate_mapping_semantics(tmp_path: Path) -> None:
    source = tmp_path / "registry.json"
    source.write_text('[{"mapping_revision":"same"}]', encoding="utf-8")

    assert json.loads(merge_mapping_registry_file(source.read_text(), str(source))) == [
        {"mapping_revision": "same"},
        {"mapping_revision": "same"},
    ]


def test_registry_file_invalid_inline_does_not_echo_private_value(tmp_path: Path) -> None:
    source = tmp_path / "registry.json"
    source.write_text("[]", encoding="utf-8")

    with pytest.raises(TokenerMappingConfigurationError) as error:
        merge_mapping_registry_file("private-inline-value", str(source))

    assert "private-inline-value" not in str(error.value)


def _mapping(revision: str) -> dict[str, object]:
    return {
        "schema_version": 1,
        "mapping_revision": revision,
        "source": {"provider_id": "langgenius/openai/openai", "model_type": "llm", "model": "gpt-4o", "mode": "chat"},
        "source_schema_digest": "sha256:" + "a" * 64,
        "settlement_owner": "shared_credit_pool",
        "pool_types": ["paid", "trial"],
        "target": {
            "plugin_id": "langgenius/tokener",
            "provider": "tokener",
            "model_type": "llm",
            "model": revision + "-target",
            "catalog_revision": "catalog-v1",
            "minimum_plugin_version": "0.4.3",
        },
        "parameter_adapter": {"id": "identity_v1", "revision": "v1", "rules_digest": "sha256:" + "b" * 64},
        "operations": ["model/schema", "llm/invoke", "llm/num_tokens"],
        "conformance_fixture_ids": ["fixture"],
    }


def test_file_registry_preserves_consumer_revision_selection_and_strict_validation(tmp_path: Path) -> None:
    source = tmp_path / "registry.json"
    inline = json.dumps([_mapping("old")])
    source.write_text(json.dumps([_mapping("new")]), encoding="utf-8")
    merged = merge_mapping_registry_file(inline, str(source))

    assert next(iter(mappings_for_revision(merged, "old").values())).target.model == "old-target"
    assert next(iter(mappings_for_revision(merged, "new").values())).target.model == "new-target"
    with pytest.raises(ValueError, match="Unknown mapping revision"):
        mappings_for_revision(merged, "latest")

    source.write_text(inline, encoding="utf-8")
    with pytest.raises(ValueError, match="Duplicate source"):
        mappings_for_revision(merge_mapping_registry_file(inline, str(source)), "old")

    invalid = _mapping("new") | {"unrecognized_field": "invalid"}
    source.write_text(json.dumps([invalid]), encoding="utf-8")
    with pytest.raises(ValidationError):
        mappings_for_revision(merge_mapping_registry_file(inline, str(source)), "old")
