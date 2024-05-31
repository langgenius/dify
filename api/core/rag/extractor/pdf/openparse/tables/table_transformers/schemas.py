from collections.abc import Sequence
from typing import Literal, Optional, Union

import fitz
from pydantic import BaseModel

###############
### SCHEMAS ###
###############

Size = tuple[int, int]
BBox = tuple[float, float, float, float]


class _TableCellModelOutput(BaseModel):
    label: Literal[
        "table spanning cell",
        "table row",
        "table column",
        "table",
        "table column header",
        "table projected row header",  # WHAT IS THIS
    ]
    confidence: float
    bbox: BBox  # note: image coordinates

    @property
    def is_header(self) -> bool:
        return self.label in ["table column header", "table projected row header"]

    @property
    def is_row(self) -> bool:
        return self.label in ["table row"]

    @property
    def is_column(self) -> bool:
        return self.label in ["table column"]


class _TableModelOutput(BaseModel):
    label: Literal["table", "table rotated"]
    confidence: float
    bbox: BBox  # note: image coordinates


class _TableHeaderCell(BaseModel):
    bbox: BBox
    content: Optional[str] = None
    variant: Literal["header"] = "header"

    def round_bbox(cls, values):
        values["bbox"] = tuple(round(coord, 0) for coord in values["bbox"])
        return values


class _TableDataCell(BaseModel):
    bbox: BBox
    content: Optional[str] = None
    variant: Literal["data"] = "data"

    def round_bbox(cls, values):
        values["bbox"] = tuple(round(coord, 0) for coord in values["bbox"])
        return values


class _TableHeader(BaseModel):
    cells: list[_TableHeaderCell]

    def sort_cells(self) -> None:
        self.cells.sort(key=lambda cell: (cell.bbox[1], cell.bbox[0]))

    @property
    def bbox(self) -> BBox:
        x0 = min(cell.bbox[0] for cell in self.cells)
        y0 = min(cell.bbox[1] for cell in self.cells)
        x1 = max(cell.bbox[2] for cell in self.cells)
        y1 = max(cell.bbox[3] for cell in self.cells)
        return (x0, y0, x1, y1)


class _TableRow(BaseModel):
    cells: list[_TableDataCell]

    def sort_cells(self) -> None:
        self.cells.sort(key=lambda cell: (cell.bbox[1], cell.bbox[0]))

    @property
    def bbox(self) -> BBox:
        x0 = min(cell.bbox[0] for cell in self.cells)
        y0 = min(cell.bbox[1] for cell in self.cells)
        x1 = max(cell.bbox[2] for cell in self.cells)
        y1 = max(cell.bbox[3] for cell in self.cells)
        return (x0, y0, x1, y1)


class _Table(BaseModel):
    bbox: BBox
    headers: list[_TableHeader]
    rows: list[_TableRow]

    ###################
    ### TABLE UTILS ###
    ###################

    def round_bbox(cls, values):
        values["bbox"] = tuple(round(coord, 0) for coord in values["bbox"])
        return values

    @classmethod
    def sort_and_validate(cls, values):
        """Sort headers and rows"""
        headers = sorted(values.get("headers", []), key=lambda h: h.bbox[1])
        rows = sorted(values.get("rows", []), key=lambda r: r.bbox[1])

        for header in headers:
            header.sort_cells()

        for row in rows:
            row.sort_cells()

        values["headers"] = headers
        values["rows"] = rows
        return values

    def _calc_col_widths(self) -> list[int]:
        max_widths = [
            max(len(cell.content or "") for cell in column)
            for column in zip(
                *[header.cells for header in self.headers]
                 + [row.cells for row in self.rows]
            )
        ]
        return max_widths

    def _generate_row_str(
            self,
            cells: Sequence[Union[_TableHeaderCell, _TableDataCell]],
            column_widths: list[int],
    ) -> str:
        """
        Generates the string for a single row based on the cell contents and column widths.
        """
        row_content = "|".join(
            " {} ".format(cell.content.ljust(width) if cell.content else " " * width)
            for cell, width in zip(cells, column_widths)
        )
        return f"|{row_content}|"

    def _generate_horizontal_border_str(self, column_widths: list[int]) -> str:
        """
        Generates the horizontal border string based on the column widths.
        """
        border = "+".join("-" * (width + 2) for width in column_widths)
        return f"+{border}+"

    def sort(self) -> None:
        self.headers.sort(
            key=lambda header: (header.cells[0].bbox[1], header.cells[0].bbox[0])
        )
        for header in self.headers:
            header.sort_cells()

        self.rows.sort(key=lambda row: (row.cells[0].bbox[1], row.cells[0].bbox[0]))
        for row in self.rows:
            row.sort_cells()

    def _run_ocr(self, pdf_page: fitz.Page):
        for header in self.headers:
            for hcell in header.cells:
                cell_rect = fitz.Rect(hcell.bbox)
                hcell.content = pdf_page.get_textbox(cell_rect)

        for row in self.rows:
            for rcell in row.cells:
                cell_rect = fitz.Rect(rcell.bbox)
                rcell.content = pdf_page.get_textbox(cell_rect)

    def to_str(self) -> str:
        """
        Generates a string representation of the table, including headers and rows,
        suitable for printing or logging.
        """
        column_widths = self._calc_col_widths()
        table_str = self._generate_horizontal_border_str(column_widths) + "\n"

        for header in self.headers:
            table_str += self._generate_row_str(header.cells, column_widths) + "\n"
            table_str += self._generate_horizontal_border_str(column_widths) + "\n"

        for row in self.rows:
            table_str += self._generate_row_str(row.cells, column_widths) + "\n"
            table_str += self._generate_horizontal_border_str(column_widths) + "\n"

        return table_str.rstrip()

    def pprint(self) -> None:
        print(self.to_str())

    def to_html_str(self) -> str:
        """
        Generates an HTML string representation of the table.

        Currently uses image coordinates - should be converted to PDF coordinates.
        """
        html_str = '<table border="1">\n'  # Start of table

        # Generate header rows
        if self.headers:
            html_str += "<thead>\n"
            for header in self.headers:
                html_str += "<tr>\n"
                for cell in header.cells:
                    min_width = round(cell.bbox[2] - cell.bbox[0])
                    html_str += f'<th style="min-width:{min_width}px;">{cell.content or ""}</th>\n'
                html_str += "</tr>\n"
            html_str += "</thead>\n"

        # Generate data rows
        html_str += "<tbody>\n"
        for row in self.rows:
            html_str += "<tr>\n"
            for cell in row.cells:  # type: ignore
                min_width = round(cell.bbox[2] - cell.bbox[0])
                html_str += (
                    f'<td style="min-width:{min_width}px;">{cell.content or ""}</td>\n'
                )
            html_str += "</tr>\n"
        html_str += "</tbody>\n"

        html_str += "</table>"  # End of table
        return html_str

    def to_markdown_str(self) -> str:
        """
        Generates a Markdown string representation of the table.
        """
        column_widths = self._calc_col_widths()
        markdown_str = ""

        # Generate header rows
        if self.headers:
            for header in self.headers:
                header_row = (
                        "| "
                        + " | ".join(
                    cell.content.ljust(width) if cell.content else " " * width
                    for cell, width in zip(header.cells, column_widths)
                )
                        + " |"
                )
                markdown_str += header_row + "\n"

                separator_row = (
                        "|:" + ":|:".join("-" * width for width in column_widths) + ":|"
                )
                markdown_str += separator_row + "\n"

        # Generate data rows
        for row in self.rows:
            data_row = (
                    "| "
                    + " | ".join(
                cell.content.ljust(width) if cell.content else " " * width
                for cell, width in zip(row.cells, column_widths)
            )
                    + " |"
            )
            markdown_str += data_row + "\n"

        return f'\n{markdown_str.rstrip()}'
