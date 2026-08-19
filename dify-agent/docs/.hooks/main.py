from __future__ import annotations

from pathlib import Path

from mkdocs.config.defaults import MkDocsConfig
from mkdocs.structure.files import Files
from mkdocs.structure.pages import Page
from snippets import inject_snippets

DOCS_ROOT = Path(__file__).resolve().parent.parent


def on_page_markdown(markdown: str, page: Page, config: MkDocsConfig, files: Files) -> str:
    """Inject repository snippets before MkDocs renders Markdown."""
    relative_path = DOCS_ROOT / page.file.src_uri
    return inject_snippets(markdown, relative_path.parent)
