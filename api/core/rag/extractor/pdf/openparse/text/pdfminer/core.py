from collections.abc import Iterable
from typing import Any, Union

from pdfminer.layout import LTChar, LTTextContainer, LTTextLine
from pydantic import BaseModel

from core.rag.extractor.pdf.openparse.pdf import Pdf
from core.rag.extractor.pdf.openparse.schemas import Bbox, LineElement, TextElement, TextSpan


class CharElement(BaseModel):
    text: str
    fontname: str
    size: float

    @property
    def is_bold(self) -> bool:
        return "Bold" in self.fontname or "bold" in self.fontname

    @property
    def is_italic(self) -> bool:
        return "Italic" in self.fontname or "italic" in self.fontname

    @classmethod
    def round_size(cls, data: Any) -> Any:
        data["size"] = round(data["size"], 2)
        return data


def _extract_chars(text_line: LTTextLine) -> list[CharElement]:
    return [
        CharElement(text=char.get_text(), fontname=char.fontname, size=char.size)
        for char in text_line
        if isinstance(char, LTChar)
    ]


def _group_chars_into_spans(chars: Iterable[CharElement]) -> list[TextSpan]:
    spans = []
    current_text = ""
    current_style = (False, False, 0.0)

    for char in chars:
        char_style = (char.is_bold, char.is_italic, char.size)
        # If the current character is a space, compress multiple spaces and continue loop.
        if char.text.isspace():
            if not current_text.endswith(" "):
                current_text += " "
            continue

        # If style changes and there's accumulated text, add it to spans.
        if char_style != current_style and current_text:
            # Ensure there is at most one space at the end of the text.
            spans.append(
                TextSpan(
                    text=current_text.rstrip()
                         + (" " if current_text.endswith(" ") else ""),
                    is_bold=current_style[0],
                    is_italic=current_style[1],
                    size=current_style[2],
                )
            )
            current_text = char.text
        else:
            current_text += char.text
        current_style = char_style

    # After the loop, add any remaining text as a new span.
    if current_text:
        spans.append(
            TextSpan(
                text=current_text.rstrip()
                     + (" " if current_text.endswith(" ") else ""),
                is_bold=current_style[0],
                is_italic=current_style[1],
                size=current_style[2],
            )
        )
    return spans


def _create_line_element(text_line: LTTextLine) -> LineElement:
    """Create a LineElement from a text line."""
    chars = _extract_chars(text_line)
    spans = _group_chars_into_spans(chars)
    bbox = (text_line.x0, text_line.y0, text_line.x1, text_line.y1)
    return LineElement(bbox=bbox, spans=tuple(spans))


def _get_bbox(lines: list[LineElement]) -> tuple[float, float, float, float]:
    """Get the bounding box of a list of LineElements."""
    x0 = min(line.bbox[0] for line in lines)
    y0 = min(line.bbox[1] for line in lines)
    x1 = max(line.bbox[2] for line in lines)
    y1 = max(line.bbox[3] for line in lines)
    return x0, y0, x1, y1


def ingest(pdf_input: Union[Pdf]) -> list[TextElement]:
    """Parse PDF and return a list of LineElement objects."""
    elements = []
    page_layouts = pdf_input.extract_layout_pages()

    for page_num, page_layout in enumerate(page_layouts):
        page_width = page_layout.width
        page_height = page_layout.height
        for element in page_layout:
            if isinstance(element, LTTextContainer):
                lines = []
                for text_line in element:
                    if isinstance(text_line, LTTextLine):
                        lines.append(_create_line_element(text_line))
                if not lines:
                    continue
                bbox = _get_bbox(lines)

                elements.append(
                    TextElement(
                        bbox=Bbox(
                            x0=bbox[0],
                            y0=bbox[1],
                            x1=bbox[2],
                            y1=bbox[3],
                            page=page_num,
                            page_width=page_width,
                            page_height=page_height,
                        ),
                        text="\n".join(line.text for line in lines),
                        lines=tuple(lines),
                    )
                )

    return elements
