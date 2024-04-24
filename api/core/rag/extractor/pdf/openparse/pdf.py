import random
import tempfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Literal, Optional, Union

from pdfminer.high_level import extract_pages
from pdfminer.layout import LAParams, LTPage
from pypdf import PdfReader, PdfWriter

from core.rag.extractor.pdf.openparse.schemas import Bbox, Node


class _BboxWithColor:
    color: tuple[float, float, float]
    bbox: Bbox
    annotation_text: Optional[Any] = None


def _random_color() -> tuple[float, float, float]:
    return (
        random.randint(0, 255) / 256,
        random.randint(0, 255) / 256,
        random.randint(0, 255) / 256,
    )


def _prepare_bboxes_for_drawing(
        bboxes: Union[list[Bbox], list[list[Bbox]]], annotations: Optional[list[str]] = None
) -> list[_BboxWithColor]:
    res = []
    assert (
        len(bboxes) == len(annotations) if annotations else True
    ), "Number of annotations must match the number of bboxes."

    for element in bboxes:
        color = _random_color()
        text = annotations.pop(0) if annotations else None
        if isinstance(element, Bbox):
            res.append(
                _BboxWithColor(
                    color=color,
                    bbox=element,
                    annotation_text=text,
                )
            )
        elif isinstance(element, list):
            sorted_bboxes = sorted(element, key=lambda x: x.page)
            for bbox in sorted_bboxes:
                res.append(
                    _BboxWithColor(
                        color=color,
                        bbox=bbox,
                        annotation_text=text,
                    )
                )

                text = "continued ..."
    return res


class Pdf:
    """
    Simple utility class for working with PDF files. This class wraps the PdfReader and PdfWriter classes from pypdf.
    """

    def __init__(self, file: Union[str, Path, PdfReader]):
        self.file_path = str(file) if isinstance(file, str | Path) else None
        self.reader = PdfReader(file) if isinstance(file, str | Path) else file
        self.writer = PdfWriter()
        for page in self.reader.pages:
            self.writer.add_page(page)

        self.num_pages = len(self.reader.pages)

    def extract_layout_pages(self) -> Iterator[LTPage]:
        """
        Yields layout objects for each page in the PDF using pdfminer.six.
        """
        assert (
                self.file_path is not None
        ), "PDF file path is required for this method for now."

        laparams = LAParams(all_texts=True, detect_vertical=True)
        yield from extract_pages(self.file_path, laparams=laparams)

    def save(self, output_pdf: Union[str, Path]) -> None:
        """
        Saves the content from the PdfWriter to a new PDF file.
        """
        with open(str(output_pdf), "wb") as out_pdf:
            self.writer.write(out_pdf)

    def extract_pages(self, start_page: int, end_page: int) -> None:
        """
        Extracts a range of pages from the PDF and adds them to the PdfWriter.
        """
        for page_num in range(start_page - 1, end_page):
            self.writer.add_page(self.reader.pages[page_num])

    def to_pymupdf_doc(self):
        """
        Transforms the PDF into a PyMuPDF (fitz) document.
        If modifications have been made using PdfWriter, it saves to a temporary file first.
        This function dynamically imports PyMuPDF (fitz), requiring it only if this method is called.
        """
        try:
            import fitz  # type: ignore
        except ImportError:
            raise ImportError(
                "PyMuPDF (fitz) is not installed. This method requires PyMuPDF."
            )

        if not self.writer.pages:
            return fitz.open(self.file_path)

        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmpfile:
            self.writer.write(tmpfile.name)
            return fitz.open(tmpfile.name)

    def _draw_bboxes(
            self,
            bboxes_with_color: list[_BboxWithColor],
            coordinates: Literal["top-left", "bottom-left"],
    ):
        try:
            import fitz
        except ImportError:
            raise ImportError(
                "PyMuPDF (fitz) is not installed. This method requires PyMuPDF."
            )

        pdf = self.to_pymupdf_doc()

        for page in pdf:
            page.wrap_contents()

            for bbox_with_color in bboxes_with_color:
                bbox = bbox_with_color.bbox
                if bbox.page != page.number:
                    continue
                if coordinates == "bottom-left":
                    bbox = self._flip_coordinates(bbox)
                rect = fitz.Rect(bbox.x0, bbox.y0, bbox.x1, bbox.y1)
                page.draw_rect(
                    rect, bbox_with_color.color
                )  # Use the color associated with this bbox

                if bbox_with_color.annotation_text:
                    page.insert_text(
                        rect.top_left,
                        str(bbox_with_color.annotation_text),
                        fontsize=12,
                    )
        return pdf

    def display_with_bboxes(
            self,
            nodes: list[Node],
            page_nums: Optional[list[int]] = None,
            annotations: Optional[list[str]] = None,
    ):
        """
        Display a single page of a PDF file using IPython.
        Optionally, display a piece of text on top of the bounding box.
        """
        try:
            from IPython.display import Image, display  # type: ignore
        except ImportError:
            raise ImportError(
                "IPython is required to display PDFs. Please install it with `pip install ipython`."
            )
        assert nodes, "At least one node is required."

        bboxes = [node.bbox for node in nodes]
        flattened_bboxes = _prepare_bboxes_for_drawing(bboxes, annotations)
        marked_up_doc = self._draw_bboxes(flattened_bboxes, nodes[0]._coordinates)
        if not page_nums:
            page_nums = list(range(marked_up_doc.page_count))
        for page_num in page_nums:
            page = marked_up_doc[page_num]
            img_data = page.get_pixmap().tobytes("png")
            display(Image(data=img_data))

    def export_with_bboxes(
            self,
            nodes: list[Node],
            output_pdf: Union[str, Path],
            annotations: Optional[list[str]] = None,
    ) -> None:
        assert nodes, "At least one node is required."

        bboxes = [node.bbox for node in nodes]
        flattened_bboxes = _prepare_bboxes_for_drawing(bboxes, annotations)
        marked_up_doc = self._draw_bboxes(flattened_bboxes, nodes[0]._coordinates)
        marked_up_doc.save(str(output_pdf))

    def _flip_coordinates(self, bbox: Bbox) -> Bbox:
        fy0 = bbox.page_height - bbox.y1
        fy1 = bbox.page_height - bbox.y0
        return Bbox(
            page=bbox.page,
            page_height=bbox.page_height,
            page_width=bbox.page_width,
            x0=bbox.x0,
            y0=fy0,
            x1=bbox.x1,
            y1=fy1,
        )
