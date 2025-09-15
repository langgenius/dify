"""Abstract interface for document loader implementations."""

import re
from pathlib import Path

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.extractor.helpers import detect_file_encodings
from core.rag.models.document import Document


class MarkdownExtractor(BaseExtractor):
    """Load Markdown files.


    Args:
        file_path: Path to the file to load.
    """

    def __init__(
        self,
        file_path: str,
        remove_hyperlinks: bool = False,
        remove_images: bool = False,
        encoding: str | None = None,
        autodetect_encoding: bool = True,
    ):
        """Initialize with file path."""
        self._file_path = file_path
        self._remove_hyperlinks = remove_hyperlinks
        self._remove_images = remove_images
        self._encoding = encoding
        self._autodetect_encoding = autodetect_encoding

    def extract(self) -> list[Document]:
        """Load from file path."""
        tups = self.parse_tups(self._file_path)
        documents = []
        for header, value in tups:
            value = value.strip()
            if header is None:
                documents.append(Document(page_content=value))
            else:
                documents.append(Document(page_content=f"\n\n{header}\n{value}"))

        return documents

    def markdown_to_tups(self, markdown_text: str) -> list[tuple[str | None, str]]:
        """Convert a markdown file to a dictionary.

        The keys are the headers and the values are the text under each header.

        """
        markdown_tups: list[tuple[str | None, str]] = []
        lines = markdown_text.split("\n")

        current_header = None
        current_text = ""
        code_block_flag = False

        for line in lines:
            if line.startswith("```"):
                code_block_flag = not code_block_flag
                current_text += line + "\n"
                continue
            if code_block_flag:
                current_text += line + "\n"
                continue
            header_match = re.match(r"^#+\s", line)
            if header_match:
                markdown_tups.append((current_header, current_text))
                current_header = line
                current_text = ""
            else:
                current_text += line + "\n"
        markdown_tups.append((current_header, current_text))

        markdown_tups = [
            (re.sub(r"#", "", key).strip() if key else None, re.sub(r"<.*?>", "", value))
            for key, value in markdown_tups
        ]

        return markdown_tups

    def remove_images(self, content: str) -> str:
        """Get a dictionary of a markdown file from its path."""
        pattern = r"!{1}\[\[(.*)\]\]"
        content = re.sub(pattern, "", content)
        return content

    def remove_hyperlinks(self, content: str) -> str:
        """Get a dictionary of a markdown file from its path."""
        pattern = r"\[(.*?)\]\((.*?)\)"
        content = re.sub(pattern, r"\1", content)
        return content

    def parse_tups(self, filepath: str) -> list[tuple[str | None, str]]:
        """Parse file into tuples."""
        content = ""
        try:
            content = Path(filepath).read_text(encoding=self._encoding)
        except UnicodeDecodeError as e:
            if self._autodetect_encoding:
                detected_encodings = detect_file_encodings(filepath)
                for encoding in detected_encodings:
                    try:
                        content = Path(filepath).read_text(encoding=encoding.encoding)
                        break
                    except UnicodeDecodeError:
                        continue
            else:
                raise RuntimeError(f"Error loading {filepath}") from e
        except Exception as e:
            raise RuntimeError(f"Error loading {filepath}") from e

        if self._remove_hyperlinks:
            content = self.remove_hyperlinks(content)

        if self._remove_images:
            content = self.remove_images(content)

        return self.markdown_to_tups(content)
