"""
This is currently unused and we choose to use the entire unitable pipeline.

Out of the total time spent on predictions, approximately 50 ish% is used for structure prediction, while about 50 ish%  is dedicated to cell prediction.

We could potentially drastically speed up inference if we use tesseract to extract the text from the table instead of unitable.
"""

from typing import Optional, Union

from pydantic import BaseModel

Size = tuple[int, int]


class BBox(BaseModel):
    left: int
    top: int
    right: int
    bottom: int

    @classmethod
    def from_tuple(
            cls,
            bbox: tuple[
                Union[int, float], Union[int, float], Union[int, float], Union[int, float]
            ],
    ) -> "BBox":
        return cls(
            left=int(bbox[0]), top=int(bbox[1]), right=int(bbox[2]), bottom=int(bbox[3])
        )


class TableCell(BaseModel):
    bbox: Optional[BBox]
    tag: str = "<td></td>"
    content: Optional[str] = None
    colspan: Optional[int] = None

    def to_html(self) -> str:
        return self.tag.replace("><", f">{self.content}<")

    @property
    def tuple_bbox(self) -> Optional[tuple[int, int, int, int]]:
        if self.bbox:
            return self.bbox.left, self.bbox.top, self.bbox.right, self.bbox.bottom
        return None


class TableRow(BaseModel):
    cells: list[TableCell]

    def to_html(self) -> str:
        cells_html = "".join(cell.to_html() for cell in self.cells)
        return f"<tr>{cells_html}</tr>"


class TableSection(BaseModel):
    rows: list[TableRow]

    def to_html(self) -> str:
        rows_html = "".join(row.to_html() for row in self.rows)
        return rows_html


class HTMLTable(BaseModel):
    header: Optional[TableSection] = None
    body: TableSection

    def to_html(self) -> str:
        header_html = f"<thead>{self.header.to_html()}</thead>" if self.header else ""
        body_html = f"<tbody>{self.body.to_html()}</tbody>"
        return f"<table>{header_html}{body_html}</table>"

    @property
    def bbox(self) -> BBox:
        raise NotImplementedError("bbox property is not implemented")

    @classmethod
    def from_model_outputs(
            cls, structure: list[str], bboxes: list[tuple[int, int, int, int]]
    ):
        raise NotImplementedError("from_model_outputs method is not implemented")

    def to_pdf_cords(
            self,
            *,
            page_size: Size,
            table_image_size: Size,
            page_image_size: Size,
            padding_pct: float,
            detection_bbox: tuple[float, float, float, float],
    ) -> "HTMLTable":
        raise NotImplementedError("to_pdf_cords method is not implemented")

    def _repr_html_(self):
        """
        When called in a Jupyter environment, this will display the node as Markdown, which Jupyter will then render as HTML.
        """
        return self.to_html()
