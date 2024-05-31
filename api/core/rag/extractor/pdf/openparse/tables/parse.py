from typing import Literal, Union

from pydantic import BaseModel, ConfigDict, Field

from ..pdf import Pdf
from ..schemas import Bbox, TableElement
from .utils import adjust_bbox_with_padding, crop_img_with_padding


class ParsingArgs(BaseModel):
    parsing_algorithm: str
    table_output_format: Literal["str", "markdown", "html"] = Field(default="html")


class TableTransformersArgs(BaseModel):
    parsing_algorithm: Literal["table-transformers"] = Field(
        default="table-transformers"
    )
    min_table_confidence: float = Field(default=0.75, ge=0.0, le=1.0)
    min_cell_confidence: float = Field(default=0.95, ge=0.0, le=1.0)
    table_output_format: Literal["str", "markdown", "html"] = Field(default="html")

    model_config = ConfigDict(extra="forbid")


class PyMuPDFArgs(BaseModel):
    parsing_algorithm: Literal["pymupdf"] = Field(default="pymupdf")
    table_output_format: Literal["str", "markdown", "html", "csv", "json"] = Field(default="html")

    model_config = ConfigDict(extra="forbid")


class PdfmimerArgs(BaseModel):
    parsing_algorithm: Literal["pdfmimer"] = Field(default="pdfmimer")
    table_output_format: Literal["str", "markdown", "html", "csv", "json"] = Field(default="html")

    model_config = ConfigDict(extra="forbid")


class UnitableArgs(BaseModel):
    parsing_algorithm: Literal["unitable"] = Field(default="unitable")
    min_table_confidence: float = Field(default=0.75, ge=0.0, le=1.0)
    table_output_format: Literal["html"] = Field(default="html")

    model_config = ConfigDict(extra="forbid")


def _ingest_with_pymupdf(
        doc: Pdf,
        parsing_args: PyMuPDFArgs,
        verbose: bool = False,
) -> list[TableElement]:
    import pdfplumber

    from . import pymupdf
    pdoc = pdfplumber.open(doc)
    tables = []
    for page_num, page in enumerate(pdoc):
        doc.num_pages = page_num
        tabs = page.find_tables()
        for i, tab in enumerate(tabs.tables):
            headers = tab.header.names
            for j, header in enumerate(headers):
                if header is None:
                    headers[j] = ""
                else:
                    headers[j] = header.strip()
            lines = tab.extract()
            if parsing_args.table_output_format == "str":
                text = pymupdf.output_to_markdown(headers, lines)
            elif parsing_args.table_output_format == "markdown":
                text = pymupdf.output_to_markdown(headers, lines)
            elif parsing_args.table_output_format == "html":
                text = pymupdf.output_to_html(headers, lines)
            elif parsing_args.table_output_format == "json":
                text = pymupdf.output_to_json(headers, lines)
            elif parsing_args.table_output_format == "csv":
                text = pymupdf.output_to_csv(headers, lines)

            if verbose:
                print(f"Page {page_num} - Table {i + 1}:\n{text}\n")

            # Flip y-coordinates to match the top-left origin system
            bbox = pymupdf.combine_header_and_table_bboxes(tab.bbox, tab.header.bbox)
            fy0 = page.rect.height - bbox[1]
            fy1 = page.rect.height - bbox[3]

            table = TableElement(
                bbox=Bbox(
                    page=page_num,
                    x0=bbox[0],
                    y0=fy0,
                    x1=bbox[2],
                    y1=fy1,
                    page_width=page.rect.width,
                    page_height=page.rect.height,
                ),
                text=text,
            )
            tables.append(table)
    return tables


def _ingest_with_pdfminer(
        doc: Pdf,
        parsing_args: PdfmimerArgs,
        verbose: bool = False,
) -> list[TableElement]:
    import pdfplumber
    from pdfplumber.table import TableSettings

    from . import pdfmimer

    with pdfplumber.open(path_or_fp=doc.file_path) as pdf:
        tables_result = []
        headers = None
        pre_page_num = 0
        pre_table_with = 0
        for page_num, page in enumerate(pdf.pages):
            doc.num_pages = page_num
            tset = TableSettings.resolve({})
            tables = page.find_tables(tset)

            for i, table in enumerate(tables):
                bbox = table.bbox
                tab = table.extract()
                table_with = bbox[2] - bbox[0]
                if pre_page_num != page_num or pre_table_with == table_with:
                    lines = tab[0:]
                else:
                    headers = tab[0]
                    lines = tab[1:]
                pre_page_num = page_num

                for j, header in enumerate(headers):
                    if header is None:
                        headers[j] = ""
                    else:
                        headers[j] = header.strip()

                if parsing_args.table_output_format == "str":
                    text = pdfmimer.output_to_markdown(headers, lines)
                elif parsing_args.table_output_format == "markdown":

                    for j, header in enumerate(headers):
                        if header is None:
                            headers[j] = ""
                        else:
                            headers[j] = header.replace("\n", "")
                    text = pdfmimer.output_to_markdown(headers, lines)
                elif parsing_args.table_output_format == "html":
                    text = pdfmimer.output_to_html(headers, lines)
                elif parsing_args.table_output_format == "json":
                    text = pdfmimer.output_to_json(headers, lines)
                elif parsing_args.table_output_format == "csv":
                    text = pdfmimer.output_to_csv(headers, lines)

                if verbose:
                    print(f"Page {page_num} - Table {i + 1}:\n{text}\n")

                # Flip y-coordinates to match the top-left origin system
                # fy0 = page.height - bbox[1]
                # fy1 = page.height - bbox[3]

                table_element = TableElement(
                    bbox=Bbox(
                        page=page_num,
                        x0=bbox[0],
                        y0=bbox[1],
                        x1=bbox[2],
                        y1=bbox[3],
                        page_width=page.width,
                        page_height=page.height,
                    ),
                    text=text,
                )
                tables_result.append(table_element)
    return tables_result


def _ingest_with_table_transformers(
        doc: Pdf,
        args: TableTransformersArgs,
        verbose: bool = False,
) -> list[TableElement]:
    try:
        from openparse.tables.utils import doc_to_imgs

        from .table_transformers.ml import find_table_bboxes, get_table_content
    except ImportError as e:
        raise ImportError(
            "Table detection and extraction requires the `torch`, `torchvision` and `transformers` libraries to be installed.",
            e,
        )
    pdoc = doc.to_pymupdf_doc()  # type: ignore
    pdf_as_imgs = doc_to_imgs(pdoc)

    pages_with_tables = {}
    for page_num, img in enumerate(pdf_as_imgs):
        pages_with_tables[page_num] = find_table_bboxes(img, args.min_table_confidence)

    tables = []
    for page_num, table_bboxes in pages_with_tables.items():
        doc.num_pages = page_num
        page = pdoc[page_num]
        page_dims = (page.rect.width, page.rect.height)
        for table_bbox in table_bboxes:
            table = get_table_content(
                page_dims,
                pdf_as_imgs[page_num],
                table_bbox.bbox,
                args.min_cell_confidence,
                verbose,
            )
            table._run_ocr(page)

            if args.table_output_format == "str":
                table_text = table.to_str()
            elif args.table_output_format == "markdown":
                table_text = table.to_markdown_str()
            elif args.table_output_format == "html":
                table_text = table.to_html_str()

            # Flip y-coordinates to match the top-left origin system
            fy0 = page.rect.height - table_bbox.bbox[3]
            fy1 = page.rect.height - table_bbox.bbox[1]

            table_elem = TableElement(
                bbox=Bbox(
                    page=page_num,
                    x0=table_bbox.bbox[0],
                    y0=fy0,
                    x1=table_bbox.bbox[2],
                    y1=fy1,
                    page_width=page.rect.width,
                    page_height=page.rect.height,
                ),
                text=table_text,
            )
            if verbose:
                print(f"Page {page_num}:\n{table_text}\n")

            tables.append(table_elem)

    return tables


def _ingest_with_unitable(
        doc: Pdf,
        args: UnitableArgs,
        verbose: bool = False,
) -> list[TableElement]:
    try:
        from openparse.tables.utils import doc_to_imgs

        from .table_transformers.ml import find_table_bboxes
        from .unitable.core import table_img_to_html

    except ImportError as e:
        raise ImportError(
            "Table detection and extraction requires the `torch`, `torchvision` and `transformers` libraries to be installed.",
            e,
        )
    pdoc = doc.to_pymupdf_doc()  # type: ignore
    pdf_as_imgs = doc_to_imgs(pdoc)

    pages_with_tables = {}
    for page_num, img in enumerate(pdf_as_imgs):
        pages_with_tables[page_num] = find_table_bboxes(img, args.min_table_confidence)

    tables = []
    for page_num, table_bboxes in pages_with_tables.items():
        doc.num_pages = page_num
        page = pdoc[page_num]
        for table_bbox in table_bboxes:
            padding_pct = 0.05
            padded_bbox = adjust_bbox_with_padding(
                bbox=table_bbox.bbox,
                page_width=page.rect.width,
                page_height=page.rect.height,
                padding_pct=padding_pct,
            )
            table_img = crop_img_with_padding(pdf_as_imgs[page_num], padded_bbox)

            table_str = table_img_to_html(table_img)

            # Flip y-coordinates to match the top-left origin system
            fy0 = page.rect.height - padded_bbox[3]
            fy1 = page.rect.height - padded_bbox[1]

            table_elem = TableElement(
                bbox=Bbox(
                    page=page_num,
                    x0=padded_bbox[0],
                    y0=fy0,
                    x1=padded_bbox[2],
                    y1=fy1,
                    page_width=page.rect.width,
                    page_height=page.rect.height,
                ),
                text=table_str,
            )

            tables.append(table_elem)

    return tables


def ingest(
        doc: Pdf,
        parsing_args: Union[TableTransformersArgs, PyMuPDFArgs, UnitableArgs, None] = None,
        verbose: bool = False,
) -> list[TableElement]:
    if isinstance(parsing_args, TableTransformersArgs):
        return _ingest_with_table_transformers(doc, parsing_args, verbose)
    elif isinstance(parsing_args, PyMuPDFArgs):
        return _ingest_with_pymupdf(doc, parsing_args, verbose)
    elif isinstance(parsing_args, UnitableArgs):
        return _ingest_with_unitable(doc, parsing_args, verbose)
    elif isinstance(parsing_args, PdfmimerArgs):
        return _ingest_with_pdfminer(doc, parsing_args, verbose)
    else:
        raise ValueError("Unsupported parsing_algorithm.")
