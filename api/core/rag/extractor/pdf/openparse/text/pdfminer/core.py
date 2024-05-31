import logging
from collections.abc import Iterable
from typing import Any, Union

from pdfminer.high_level import extract_pages
from pdfminer.layout import (
    LAParams,
    LTChar,
    LTCurve,
    LTFigure,
    LTImage,
    LTLine,
    LTRect,
    LTTextBoxHorizontal,
    LTTextContainer,
    LTTextLine,
)
from pydantic import BaseModel

from core.rag.extractor.pdf.openparse.pdf import Pdf
from core.rag.extractor.pdf.openparse.schemas import Bbox, ImageElement, LineElement, TextElement, TextSpan

log = logging.getLogger(__name__)


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


def process_page_layout(page_num: int, page_height: int, page_width: int, element: Any):
    elements = []
    if isinstance(element, LTFigure):
        ele = element._objs
        if ele is None:
            log.error(f"element._objs is None: {type(element)}")
            return
        elif isinstance(ele, LTImage):
            elements.append(
                ImageElement(
                    bbox=Bbox(
                        x0=ele.bbox[0],
                        y0=ele.bbox[1],
                        x1=ele.bbox[2],
                        y1=ele.bbox[3],
                        page=page_num,
                        page_width=ele.width,
                        page_height=ele.height,
                    ),
                    image=ele.stream.get_data(),
                    ext="png",
                    text=ele.name,
                )
            )
        elif isinstance(ele, LTFigure):
            process_page_layout(page_num=page_num, page_height=page_height, page_width=page_width, element=ele)
        elif isinstance(ele, list):
            for e in ele:
                eles = process_page_layout(page_num=page_num, page_height=page_height, page_width=page_width, element=e)
                if len(eles) > 0:
                    elements.extend(eles)
        else:
            log.error(f"LTFigure Unknown element type: {type(ele)}")

    elif isinstance(element, LTTextContainer | LTTextLine | LTChar | LTTextBoxHorizontal):
        lines = []
        for text_line in element:
            if isinstance(text_line, LTTextLine):
                lines.append(_create_line_element(text_line))
        if not lines:
            return
        bbox = _get_bbox(lines)
        # bbox = element.bbox
        # print(bbox, "\n".join(line.text for line in lines))
        fy0 = page_height - bbox[1]
        fy1 = page_height - bbox[3]
        elements.append(
            TextElement(
                bbox=Bbox(
                    x0=bbox[0],
                    y0=fy0,
                    x1=bbox[2],
                    y1=fy1,
                    page=page_num,
                    page_width=page_width,
                    page_height=page_height,
                ),
                text="\n".join(line.text for line in lines),
                lines=tuple(lines),
            )
        )
    elif isinstance(element, LTImage):
        elements.append(
            ImageElement(
                bbox=Bbox(
                    x0=element.bbox[0],
                    y0=element.bbox[1],
                    x1=element.bbox[2],
                    y1=element.bbox[3],
                    page=page_num,
                    page_width=element.width,
                    page_height=element.height,
                ),
                image=element.stream.get_data(),
                ext="png",
                text=element.name,
            )
        )
    elif isinstance(element, LTLine):
        pass
    elif isinstance(element, LTRect):
        pass
    elif isinstance(element, LTCurve):
        # img = Image.new("RGB", (int(element.width), int(element.height)), color="white")
        # draw = ImageDraw.Draw(img)
        # for i in range(len(element.pts) - 1):
        #     x0, y0 = element.pts[i]
        #     x1, y1 = element.pts[i + 1]
        #     draw.line([(x0, element.height - y0), (x1, element.height - y1)], fill=element.stroke or 'black',
        #               width=int(element.linewidth))
        #
        # elements.append(
        #     ImageElement(
        #         bbox=Bbox(
        #             x0=element.bbox[0],
        #             y0=element.bbox[1],
        #             x1=element.bbox[2],
        #             y1=element.bbox[3],
        #             page=page_num,
        #             page_width=element.width,
        #             page_height=element.height,
        #         ),
        #         image=img.getdata(),
        #         ext="png",
        #         text=str(uuid.uuid4()),
        #     )
        # )
        pass

    else:
        log.error(f"Unknown element type: {type(element)}")
    return elements


def ingest(pdf_input: Union[Pdf]) -> list[TextElement]:
    """Parse PDF and return a list of LineElement objects."""
    elements = []
    laparams = LAParams(all_texts=True, detect_vertical=True)

    page_layouts = extract_pages(pdf_input.file_path, laparams=laparams)
    for page_num, page_layout in enumerate(page_layouts):
        pdf_input.num_pages = page_num
        page_width = page_layout.width
        page_height = page_layout.height
        for element in page_layout:
            eles = process_page_layout(page_num=page_num, page_height=page_height, page_width=page_width,
                                       element=element)
            if len(eles) > 0:
                elements.extend(eles)
    return elements
