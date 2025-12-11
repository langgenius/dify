"""Abstract interface for document loader implementations."""

import os
from typing import cast

import pandas as pd
from openpyxl import load_workbook

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document


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
            # Read only mode is faster and uses less memory
            wb = load_workbook(self._file_path, read_only=True, data_only=True)
            for sheet_name in wb.sheetnames:
                sheet = wb[sheet_name]
                
                # 1. Find Header Row and determine valid columns
                header_row_idx, column_map, max_col_idx = self._find_header_and_columns(sheet)
                
                if not column_map:
                    continue

                # 2. Stream rows using the determined boundaries
                # min_row is 1-based index in openpyxl
                # We start reading from the next row after header
                start_row = header_row_idx + 1
                
                # iter_rows yields tuples of cells. 
                # We strictly limit max_col to avoid reading ghost columns (memory leak protection).
                for row in sheet.iter_rows(min_row=start_row, max_col=max_col_idx, values_only=False):
                    # Check if row is completely empty
                    if all(cell.value is None for cell in row):
                        continue
                        
                    page_content = []
                    for col_idx, cell in enumerate(row):
                        value = cell.value
                        # col_idx is 0-based, matches our column_map keys
                        if col_idx in column_map:
                            col_name = column_map[col_idx]
                            
                            # Handle Hyperlinks
                            if hasattr(cell, "hyperlink") and cell.hyperlink:
                                target = getattr(cell.hyperlink, "target", None)
                                if target:
                                    value = f"[{value}]({target})"

                            # Handle None and basic types
                            if value is None:
                                value = ""
                            elif not isinstance(value, str):
                                value = str(value)
                                
                            value = value.strip()
                            # Always append the key-value pair, even if value is empty.
                            # This ensures that all columns from the header are present in the document content.
                            page_content.append(f'"{col_name}":"{value}"')

                    
                    if page_content:
                        documents.append(
                            Document(page_content=";".join(page_content), metadata={"source": self._file_path})
                        )
            
            # Close the workbook if opened in read_only mode
            wb.close()

        elif file_extension == ".xls":
            excel_file = pd.ExcelFile(self._file_path, engine="xlrd")
            for excel_sheet_name in excel_file.sheet_names:
                df = excel_file.parse(sheet_name=excel_sheet_name)
                df.dropna(how="all", inplace=True)

                for _, row in df.iterrows():
                    page_content = []
                    for k, v in row.items():
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
        candidates = []
        
        # Limit scan to avoid performance issues on huge files
        # We iterate manually to control the read scope
        current_row_idx = 0
        for row in sheet.iter_rows(min_row=1, max_row=scan_rows, values_only=True):
            current_row_idx += 1
            
            # Filter out empty cells and build a temp map for this row
            # col_idx is 0-based
            row_map = {}
            for col_idx, cell_value in enumerate(row):
                if cell_value is not None and str(cell_value).strip():
                    row_map[col_idx] = str(cell_value).strip()
            
            if not row_map:
                continue
                
            non_empty_count = len(row_map)
            
            # Heuristic: 
            # 1. Prefer rows with multiple columns (unless file is single column)
            # 2. Prefer rows where values are strings (headers usually are) - implicit in str() conversion above but we could be stricter
            candidates.append({
                "idx": current_row_idx,
                "count": non_empty_count,
                "map": row_map
            })

        if not candidates:
            return 0, {}, 0

        # Sort candidates to find the best header
        # Primary key: non_empty_count (descending)
        # Secondary key: row index (ascending) - handled by stable sort or manual logic
        # But we want to prioritize the FIRST row that looks "good enough" (e.g. > 1 column)
        # rather than just the absolute max, to handle cases where data rows might have extra columns.
        
        best_candidate = None
        
        # Strategy: Pick the first row that has a "significant" number of columns.
        # If the max column count across all scanned rows is small (e.g. 1 or 2), just take the max.
        # If there are rows with many columns, pick the first one that reaches a threshold (e.g. > 50% of max width).
        
        for cand in candidates:
            # If we find a row that has close to the max columns found (e.g. at least 80% of max),
            # and it's early in the file, it's likely the header.
            # Using 0.8 factor allows for some missing header names compared to a fully populated data row,
            # but usually header row is fully populated for valid columns.
            # Let's be simple: The first row that has > 1 column is a strong candidate for header 
            # if we assume headers are at top.
            
            # User case: Row 1 has 1 col (Title), Row 2 has N cols (Header).
            # We want Row 2.
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
        if best_candidate["map"]:
            max_col_idx = max(best_candidate["map"].keys()) + 1
        else:
            max_col_idx = 1
            
        return best_candidate["idx"], best_candidate["map"], max_col_idx

