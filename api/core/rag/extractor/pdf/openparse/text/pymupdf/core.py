from typing import Optional

from tqdm import tqdm

from core.rag.extractor.pdf.openparse.pdf import Pdf
from core.rag.extractor.pdf.openparse.schemas import Bbox, ImageElement, LineElement, TextElement, TextSpan


def flags_decomposer(flags: int) -> str:
    """Make font flags human readable."""
    l = []
    if flags & 2 ** 0:
        l.append("superscript")
    if flags & 2 ** 1:
        l.append("italic")
    if flags & 2 ** 2:
        l.append("serifed")
    else:
        l.append("sans")
    if flags & 2 ** 3:
        l.append("monospaced")
    else:
        l.append("proportional")
    if flags & 2 ** 4:
        l.append("bold")
    return ", ".join(l)


def is_bold(flags) -> bool:
    return bool(flags & 2 ** 4)


def is_italic(flags) -> bool:
    return bool(flags & 2 ** 1)


def _lines_from_ocr_output(lines: dict, error_margin: float = 0) -> list[LineElement]:
    """
    Creates LineElement objects from given lines, combining overlapping ones.
    """
    combined: list[LineElement] = []

    for line in lines:
        bbox = line["bbox"]
        spans = [
            TextSpan(
                text=span["text"],
                is_bold=is_bold(span["flags"]),
                is_italic=is_italic(span["flags"]),
                size=span["size"],
            )
            for span in line["spans"]
        ]

        line_element = LineElement(bbox=bbox, spans=tuple(spans))
        for i, other in enumerate(combined):
            overlaps = line_element.overlaps(other, error_margin=error_margin)
            similar_height = line_element.is_at_similar_height(
                other, error_margin=error_margin
            )

            if overlaps and similar_height:
                combined[i] = line_element.combine(other)
                break
        else:
            combined.append(line_element)

    return combined


def ingest(
        doc: Pdf, ocr: bool = False, max_parser_page: Optional[int] = None
) -> list[TextElement]:
    """Parses text elements from a given pdf document."""
    elements = []

    try:
        import fitz  # type: ignore
    except ImportError:
        raise ImportError(
            "PyMuPDF (fitz) is not installed. This method requires PyMuPDF."
        )

    pdoc = fitz.open(doc.file_path)

    for page_num, page in tqdm(enumerate(pdoc), desc="pdf processing"):
        # page_ocr = page.get_textpage_ocr(flags=0, full=False)
        # for node in page.get_text("dict", textpage=page_ocr, sort=True)["blocks"]:
        doc.num_pages = page_num
        if max_parser_page is not None and page_num >= max_parser_page:
            return elements
        layout = page.get_text("dict", sort=True)
        for node in layout["blocks"]:
            fy0 = page.rect.height - node["bbox"][1]
            fy1 = page.rect.height - node["bbox"][3]
            if node["type"] == 1:
                img_info = page.get_images(node["bbox"])
                if len(img_info) > 0:
                    name = f'{img_info[0][7]}.{node["ext"]}'
                else:
                    name = f'test.{node["ext"]}'
                elements.append(
                    ImageElement(
                        bbox=Bbox(
                            x0=node["bbox"][0],
                            y0=fy0,
                            x1=node["bbox"][2],
                            y1=fy1,
                            page=page_num,
                            page_width=page.rect.width,
                            page_height=page.rect.height,
                        ),
                        image=node["image"],
                        ext=node["ext"],
                        text=name,
                    )
                )
            if node["type"] == 0:
                lines = _lines_from_ocr_output(node["lines"])
                text = ''
                for line in lines:
                    for span in line.spans:
                        text += span.text
                elements.append(
                    TextElement(
                        bbox=Bbox(
                            x0=node["bbox"][0],
                            y0=fy0,
                            x1=node["bbox"][2],
                            y1=fy1,
                            page=page_num,
                            page_width=page.rect.width,
                            page_height=page.rect.height,
                        ),
                        text=text,
                        lines=tuple(lines),
                    )
                )
    return elements
