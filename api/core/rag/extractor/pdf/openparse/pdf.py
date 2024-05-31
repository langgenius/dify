import random
from io import BytesIO
from pathlib import Path
from typing import Any, Optional, Union

from core.rag.extractor.pdf.openparse.schemas import Bbox


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
                _BboxWithColor(color=color, bbox=element, annotation_text=text)
            )
        elif isinstance(element, list):
            sorted_bboxes = sorted(element, key=lambda x: x.page)
            for bbox in sorted_bboxes:
                res.append(
                    _BboxWithColor(color=color, bbox=bbox, annotation_text=text)
                )

                text = "continued ..."
    return res


class Pdf:
    """
    Simple utility class for working with PDF files. This class wraps the PdfReader and PdfWriter classes from pypdf.
    """

    def __init__(self, file: Union[str, Path, BytesIO]):
        if isinstance(file, Path | str):
            self.file_path = str(file)
            self.name = Path(file).name
        elif isinstance(file, BytesIO):
            self.name = "tmp.pdf"
            self.file_path = file
        else:
            raise ValueError("Invalid file type")
