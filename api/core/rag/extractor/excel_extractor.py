"""Abstract interface for document loader implementations."""

import os
from typing import TypedDict

import pandas as pd
from openpyxl import load_workbook

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document


class Candidate(TypedDict):
    idx: int
    count: int
    map: dict[int, str]


class ExcelExtractor(BaseExtractor):
    """Load Excel files.


    Args:
        file_path: Path to the file to load.
    """

    def __init__(self, file_path: str, encoding: str | None = None, autodetect_encoding: bool = False):
        """Initialize with file path."""
        self._file_path = file_path
        self._encoding = encoding
        self._autodetect_encoding = autodetect_encoding

    def extract(self) -> list[Document]:
        """Load from Excel file in xls or xlsx format using Pandas and openpyxl."""
        documents = []
        file_extension = os.path.splitext(self._file_path)[-1].lower()

        if file_extension == ".xlsx":
            wb = load_workbook(self._file_path, read_only=True, data_only=True)
            try:
                for sheet_name in wb.sheetnames:
                    sheet = wb[sheet_name]
                    header_row_idx, column_map, max_col_idx = self._find_header_and_columns(sheet)
                    if not column_map:
                        continue
                    start_row = header_row_idx + 1
                    for row in sheet.iter_rows(min_row=start_row, max_col=max_col_idx, values_only=False):
                        if all(cell.value is None for cell in row):
                            continue
                        page_content = []
                        for col_idx, cell in enumerate(row):
                            value = cell.value
                            if col_idx in column_map:
                                col_name = column_map[col_idx]
                                if hasattr(cell, "hyperlink") and cell.hyperlink:
                                    target = getattr(cell.hyperlink, "target", None)
                                    if target:
                                        value = f"[{value}]({target})"
                                if value is None:
                                    value = ""
                                elif not isinstance(value, str):
                                    value = str(value)
                                value = value.strip().replace('"', '\\"')
                                page_content.append(f'"{col_name}":"{value}"')
                        if page_content:
                            documents.append(
                                Document(page_content=";".join(page_content), metadata={"source": self._file_path})
                            )
            finally:
                wb.close()

        elif file_extension == ".xls":
            excel_file = pd.ExcelFile(self._file_path, engine="xlrd")
            for excel_sheet_name in excel_file.sheet_names:
                df = excel_file.parse(sheet_name=excel_sheet_name)
                df.dropna(how="all", inplace=True)

                for _, series_row in df.iterrows():
                    page_content = []
                    for k, v in series_row.items():
                        if pd.notna(v):
                            page_content.append(f'"{k}":"{v}"')
                    documents.append(
                        Document(page_content=";".join(page_content), metadata={"source": self._file_path})
                    )
        else:
            raise ValueError(f"Unsupported file extension: {file_extension}")

        return documents

    def _find_header_and_columns(self, sheet, scan_rows=10) -> tuple[int, dict[int, str], int]:
        """
        Scan first N rows to find the most likely header row.
        Returns:
            header_row_idx: 1-based index of the header row
            column_map: Dict mapping 0-based column index to column name
            max_col_idx: 1-based index of the last valid column (for iter_rows boundary)
        """
        # Store potential candidates: (row_index, non_empty_count, column_map)
        candidates: list[Candidate] = []

        # Limit scan to avoid performance issues on huge files
        # We iterate manually to control the read scope
        for current_row_idx, row in enumerate(sheet.iter_rows(min_row=1, max_row=scan_rows, values_only=True), start=1):
            # Filter out empty cells and build a temp map for this row
            # col_idx is 0-based
            row_map = {}
            for col_idx, cell_value in enumerate(row):
                if cell_value is not None and str(cell_value).strip():
                    row_map[col_idx] = str(cell_value).strip().replace('"', '\\"')

            if not row_map:
                continue

            non_empty_count = len(row_map)

            # Header selection heuristic (implemented):
            # - Prefer the first row with at least 2 non-empty columns.
            # - Fallback: choose the row with the most non-empty columns
            #   (tie-breaker: smaller row index).
            candidates.append({"idx": current_row_idx, "count": non_empty_count, "map": row_map})

        if not candidates:
            return 0, {}, 0

        # Choose the best candidate header row.

        best_candidate: Candidate | None = None

        # Strategy: prefer the first row with >= 2 non-empty columns; otherwise fallback.

        for cand in candidates:
            if cand["count"] >= 2:
                best_candidate = cand
                break

        # Fallback: if no row has >= 2 columns, or all have 1, just take the one with max columns
        if not best_candidate:
            # Sort by count desc, then index asc
            candidates.sort(key=lambda x: (-x["count"], x["idx"]))
            best_candidate = candidates[0]

        # Determine max_col_idx (1-based for openpyxl)
        # It is the index of the last valid column in our map + 1
        max_col_idx = max(best_candidate["map"].keys()) + 1

        return best_candidate["idx"], best_candidate["map"], max_col_idx
