"""Unit tests for the Markdown API docs generator."""

import importlib.util
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
    swagger_dir = tmp_path / "openapi"
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

    written_paths = module.generate_markdown_docs(swagger_dir, markdown_dir)

    assert [path.name for path in written_paths] == [
        "console-swagger.md",
        "web-swagger.md",
        "service-swagger.md",
    ]
    assert not stale_combined_doc.exists()
    assert not list(swagger_dir.glob("*.json"))

    console_markdown = (markdown_dir / "console-swagger.md").read_text(encoding="utf-8")
    assert "## FastOpenAPI Preview (OpenAPI 3.0)" in console_markdown
    assert "### fastopenapi-console-openapi" in console_markdown
    assert "#### Routes" in console_markdown
    assert "FastOpenAPI Preview" not in (markdown_dir / "web-swagger.md").read_text(encoding="utf-8")
    assert "FastOpenAPI Preview" not in (markdown_dir / "service-swagger.md").read_text(encoding="utf-8")


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
