"""Unit tests for the Markdown API docs generator."""

import importlib.util
import json
import sys
from pathlib import Path


def _load_generate_swagger_markdown_docs_module():
    api_dir = Path(__file__).resolve().parents[3]
    script_path = api_dir / "dev" / "generate_swagger_markdown_docs.py"

    spec = importlib.util.spec_from_file_location("generate_swagger_markdown_docs", script_path)
    assert spec
    assert spec.loader

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)  # type: ignore[attr-defined]
    return module


def test_generate_markdown_docs_keeps_split_docs_and_merges_fastopenapi_into_console(tmp_path, monkeypatch):
    module = _load_generate_swagger_markdown_docs_module()
    openapi_dir = tmp_path / "openapi"
    markdown_dir = tmp_path / "markdown"
    stale_combined_doc = markdown_dir / "api-reference.md"
    markdown_dir.mkdir()
    stale_combined_doc.write_text("stale", encoding="utf-8")

    def write_specs(output_dir: Path) -> list[Path]:
        output_dir.mkdir(parents=True, exist_ok=True)
        paths = []
        for target in module.SPEC_TARGETS:
            path = output_dir / target.filename
            path.write_text("{}", encoding="utf-8")
            paths.append(path)
        return paths

    def write_fastopenapi_specs(output_dir: Path) -> list[Path]:
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / module.FASTOPENAPI_SPEC_TARGETS[0].filename
        path.write_text("{}", encoding="utf-8")
        return [path]

    def convert_spec_to_markdown(spec_path: Path, markdown_path: Path) -> None:
        markdown_path.write_text(f"# {spec_path.stem}\n\n## Routes\n", encoding="utf-8")

    monkeypatch.setattr(module, "generate_specs", write_specs)
    monkeypatch.setattr(module, "generate_fastopenapi_specs", write_fastopenapi_specs)
    monkeypatch.setattr(module, "_convert_spec_to_markdown", convert_spec_to_markdown)

    written_paths = module.generate_markdown_docs(openapi_dir, markdown_dir)

    assert [path.name for path in written_paths] == [
        "console-openapi.md",
        "web-openapi.md",
        "service-openapi.md",
        "openapi-openapi.md",
    ]
    assert not stale_combined_doc.exists()
    assert not list(openapi_dir.glob("*.json"))

    console_markdown = (markdown_dir / "console-openapi.md").read_text(encoding="utf-8")
    assert "## FastOpenAPI Preview (OpenAPI 3.1)" in console_markdown
    assert "### fastopenapi-console-openapi" in console_markdown
    assert "#### Routes" in console_markdown
    assert "FastOpenAPI Preview" not in (markdown_dir / "web-openapi.md").read_text(encoding="utf-8")
    assert "FastOpenAPI Preview" not in (markdown_dir / "service-openapi.md").read_text(encoding="utf-8")


def test_generate_markdown_docs_only_removes_generated_specs_from_separate_swagger_dir(tmp_path, monkeypatch):
    module = _load_generate_swagger_markdown_docs_module()
    swagger_dir = tmp_path / "swagger"
    markdown_dir = tmp_path / "markdown"
    swagger_dir.mkdir()
    existing_file = swagger_dir / "existing.txt"
    existing_file.write_text("keep me", encoding="utf-8")

    def write_specs(output_dir: Path) -> list[Path]:
        output_dir.mkdir(parents=True, exist_ok=True)
        paths = []
        for target in module.SPEC_TARGETS:
            path = output_dir / target.filename
            path.write_text("{}", encoding="utf-8")
            paths.append(path)
        return paths

    def write_fastopenapi_specs(output_dir: Path) -> list[Path]:
        output_dir.mkdir(parents=True, exist_ok=True)
        path = output_dir / module.FASTOPENAPI_SPEC_TARGETS[0].filename
        path.write_text("{}", encoding="utf-8")
        return [path]

    def convert_spec_to_markdown(spec_path: Path, markdown_path: Path) -> None:
        markdown_path.write_text(f"# {spec_path.stem}\n", encoding="utf-8")

    monkeypatch.setattr(module, "generate_specs", write_specs)
    monkeypatch.setattr(module, "generate_fastopenapi_specs", write_fastopenapi_specs)
    monkeypatch.setattr(module, "_convert_spec_to_markdown", convert_spec_to_markdown)

    module.generate_markdown_docs(swagger_dir, markdown_dir)

    assert existing_file.read_text(encoding="utf-8") == "keep me"
    assert not list(swagger_dir.glob("*.json"))


def test_patch_union_schema_markdown_fills_converter_blank_schema_types(tmp_path):
    module = _load_generate_swagger_markdown_docs_module()
    spec_path = tmp_path / "console-openapi.json"
    spec_path.write_text(
        json.dumps(
            {
                "components": {
                    "schemas": {
                        "FormInputConfig": {
                            "oneOf": [
                                {"$ref": "#/components/schemas/ParagraphInputConfig"},
                                {"$ref": "#/components/schemas/SelectInputConfig"},
                                {"$ref": "#/components/schemas/FileInputConfig"},
                            ],
                        },
                        "ParagraphInputConfig": {
                            "properties": {
                                "default": {
                                    "anyOf": [
                                        {"$ref": "#/components/schemas/StringSource"},
                                        {"type": "null"},
                                    ],
                                },
                                "output_variable_name": {"type": "string"},
                            },
                        },
                        "SelectInputConfig": {
                            "properties": {
                                "option_source": {"$ref": "#/components/schemas/StringListSource"},
                            },
                        },
                        "FileInputConfig": {
                            "properties": {
                                "allowed_file_types": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/FileType"},
                                },
                            },
                        },
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    markdown = """#### FormInputConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| FormInputConfig |  |  |  |

#### ParagraphInputConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| default |  |  | No |
| output_variable_name | string |  | Yes |

#### SelectInputConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| option_source |  |  | Yes |

#### FileInputConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| allowed_file_types |  |  | No |
"""

    patched = module._patch_union_schema_markdown(markdown, spec_path)

    assert (
        "| FormInputConfig | "
        "[ParagraphInputConfig](#paragraphinputconfig)<br>"
        "[SelectInputConfig](#selectinputconfig)<br>"
        "[FileInputConfig](#fileinputconfig) |  |  |"
    ) in patched
    assert "| default | [StringSource](#stringsource) |  | No |" in patched
    assert "| output_variable_name | string |  | Yes |" in patched
    assert "| option_source | [StringListSource](#stringlistsource) |  | Yes |" in patched
    assert "| allowed_file_types | [ [FileType](#filetype) ] |  | No |" in patched


def test_patch_union_schema_markdown_fills_regular_schema_union_property(tmp_path):
    module = _load_generate_swagger_markdown_docs_module()
    spec_path = tmp_path / "service-openapi.json"
    spec_path.write_text(
        json.dumps(
            {
                "components": {
                    "schemas": {
                        "DocumentMetadataResponse": {
                            "properties": {
                                "id": {"type": "string"},
                                "value": {
                                    "anyOf": [
                                        {"type": "string"},
                                        {"type": "integer"},
                                        {"type": "number"},
                                        {"type": "boolean"},
                                        {"type": "null"},
                                    ],
                                },
                            },
                        },
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    markdown = """#### DocumentMetadataResponse

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| id | string |  | Yes |
| value | string |  | No |
"""

    patched = module._patch_union_schema_markdown(markdown, spec_path)

    assert "| value | string<br>integer<br>number<br>boolean |  | No |" in patched


def test_patch_union_schema_markdown_ignores_specs_without_schemas(tmp_path):
    module = _load_generate_swagger_markdown_docs_module()
    spec_path = tmp_path / "console-openapi.json"
    spec_path.write_text("{}", encoding="utf-8")

    assert module._patch_union_schema_markdown("unchanged", spec_path) == "unchanged"


def test_patch_union_schema_markdown_ignores_unrenderable_shapes(tmp_path):
    module = _load_generate_swagger_markdown_docs_module()
    spec_path = tmp_path / "console-openapi.json"
    spec_path.write_text(
        json.dumps(
            {
                "components": {
                    "schemas": {
                        "NotAMapping": [],
                        "BrokenUnion": {
                            "oneOf": [
                                {},
                                {"$ref": "#/components/schemas/Missing"},
                                {"$ref": "#/components/schemas/NoPropertyMapping"},
                            ],
                        },
                        "NoPropertyMapping": {"properties": []},
                    },
                }
            }
        ),
        encoding="utf-8",
    )

    assert module._schema_ref_name(None) is None
    assert module._schema_markdown_type(None) == ""
    assert module._schema_markdown_type({"anyOf": [{"type": "null"}]}) == ""
    assert module._replace_schema_table_type("unchanged", "Definition", "field", "") == "unchanged"
    assert (
        module._replace_schema_table_type(
            "#### Definition\n#### Next\n| field |  |  | No |",
            "Definition",
            "field",
            "string",
        )
        == "#### Definition\n#### Next\n| field |  |  | No |"
    )
    assert (
        module._replace_schema_table_type("#### Definition\n| field |", "Definition", "field", "string")
        == "#### Definition\n| field |"
    )

    assert module._patch_union_schema_markdown("#### BrokenUnion\n", spec_path) == "#### BrokenUnion\n"


def test_convert_spec_to_markdown_patches_generated_union_tables(tmp_path, monkeypatch):
    module = _load_generate_swagger_markdown_docs_module()
    spec_path = tmp_path / "console-openapi.json"
    output_path = tmp_path / "console-openapi.md"
    spec_path.write_text(
        json.dumps(
            {
                "components": {
                    "schemas": {
                        "FormInputConfig": {
                            "oneOf": [
                                {"$ref": "#/components/schemas/ParagraphInputConfig"},
                            ],
                        },
                        "ParagraphInputConfig": {
                            "properties": {
                                "default": {
                                    "anyOf": [
                                        {"$ref": "#/components/schemas/StringSource"},
                                        {"type": "null"},
                                    ],
                                },
                            },
                        },
                    },
                }
            }
        ),
        encoding="utf-8",
    )

    def run_converter(args, **kwargs):
        assert kwargs["check"] is False
        markdown_path = Path(args[args.index("-o") + 1])
        markdown_path.write_text(
            """#### FormInputConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| FormInputConfig |  |  |  |

#### ParagraphInputConfig

| Name | Type | Description | Required |
| ---- | ---- | ----------- | -------- |
| default |  |  | No |
""",
            encoding="utf-8",
        )
        return module.subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(module.subprocess, "run", run_converter)

    module._convert_spec_to_markdown(spec_path, output_path)

    converted = output_path.read_text(encoding="utf-8")
    assert "| FormInputConfig | [ParagraphInputConfig](#paragraphinputconfig) |  |  |" in converted
    assert "| default | [StringSource](#stringsource) |  | No |" in converted
