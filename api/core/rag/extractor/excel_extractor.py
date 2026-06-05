"""Excel document extractor used for RAG ingestion.

Supports cell hyperlinks for both `.xls` and `.xlsx`, and embedded worksheet images
for `.xlsx` files by converting them into markdown image links.
"""

import logging
import mimetypes
import os
import uuid
from typing import TypedDict, override

import pandas as pd
from openpyxl import load_workbook

from configs import dify_config
from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from extensions.ext_database import db
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole
from models.model import UploadFile

logger = logging.getLogger(__name__)


class Candidate(TypedDict):
    idx: int
    count: int
    map: dict[int, str]


class ExcelExtractor(BaseExtractor):
    """Load Excel files.

    Args:
        file_path: Path to the file to load.
    """

    _file_path: str
    _encoding: str | None
    _autodetect_encoding: bool
    _tenant_id: str | None
    _user_id: str | None

    def __init__(
        self,
        file_path: str,
        tenant_id: str | None = None,
        user_id: str | None = None,
        encoding: str | None = None,
        autodetect_encoding: bool = False,
    ):
        """Initialize with file path."""
        self._file_path = file_path
        self._tenant_id = tenant_id
        self._user_id = user_id
        self._encoding = encoding
        self._autodetect_encoding = autodetect_encoding

    @override
    def extract(self) -> list[Document]:
        """Load from Excel file in xls or xlsx format using Pandas and openpyxl."""
        documents = []
        file_extension = os.path.splitext(self._file_path)[-1].lower()

        if file_extension == ".xlsx":
            # Worksheet drawing objects, including embedded images, are not available in read-only mode.
            wb = load_workbook(self._file_path, data_only=True)
            try:
                upload_files: list[UploadFile] = []
                for sheet_name in wb.sheetnames:
                    sheet = wb[sheet_name]
                    header_row_idx, column_map, max_col_idx = self._find_header_and_columns(sheet)
                    if not column_map:
                        continue
                    start_row = header_row_idx + 1
                    sheet_image_map, sheet_upload_files = self._extract_images_from_sheet(
                        sheet,
                        valid_columns={column_idx + 1 for column_idx in column_map},
                        min_row=start_row,
                    )
                    upload_files.extend(sheet_upload_files)
                    for row in sheet.iter_rows(min_row=start_row, max_col=max_col_idx, values_only=False):
                        page_content = []
                        row_has_content = False
                        for col_idx, cell in enumerate(row):
                            value = cell.value
                            if col_idx in column_map:
                                col_name = column_map[col_idx]
                                if hasattr(cell, "hyperlink") and cell.hyperlink:
                                    target = getattr(cell.hyperlink, "target", None)
                                    if target:
                                        display_value = value if value is not None and str(value).strip() else target
                                        value = f"[{display_value}]({target})"
                                image_links = sheet_image_map.get((cell.row, cell.column), [])
                                if value is None:
                                    value = ""
                                elif not isinstance(value, str):
                                    value = str(value)
                                if image_links:
                                    value = " ".join(filter(None, [value, " ".join(image_links)]))
                                value = value.strip()
                                if value:
                                    row_has_content = True
                                value = value.replace('"', '\\"')
                                page_content.append(f'"{col_name}":"{value}"')
                        if row_has_content and page_content:
                            documents.append(
                                Document(page_content=";".join(page_content), metadata={"source": self._file_path})
                            )
                if upload_files:
                    db.session.add_all(upload_files)
                    db.session.commit()
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

    def _extract_images_from_sheet(
        self, sheet, valid_columns: set[int], min_row: int
    ) -> tuple[dict[tuple[int, int], list[str]], list[UploadFile]]:
        """Extract embedded worksheet images and map them to their anchor cell."""
        if not self._tenant_id or not self._user_id:
            return {}, []

        image_map: dict[tuple[int, int], list[str]] = {}
        upload_files: list[UploadFile] = []
        images = getattr(sheet, "_images", None) or []
        base_url = dify_config.FILES_URL

        for image in images:
            marker = getattr(getattr(image, "anchor", None), "_from", None)
            row_idx = getattr(marker, "row", None)
            col_idx = getattr(marker, "col", None)
            if row_idx is None or col_idx is None:
                continue
            if row_idx + 1 < min_row or col_idx + 1 not in valid_columns:
                continue

            image_bytes = self._get_image_bytes(image)
            if not image_bytes:
                continue

            image_ext = self._get_image_extension(image)
            if not image_ext:
                continue

            file_uuid = str(uuid.uuid4())
            file_key = f"image_files/{self._tenant_id}/{file_uuid}.{image_ext}"
            mime_type, _ = mimetypes.guess_type(file_key)
            storage.save(file_key, image_bytes)

            upload_file = UploadFile(
                tenant_id=self._tenant_id,
                storage_type=StorageType(dify_config.STORAGE_TYPE),
                key=file_key,
                name=file_key,
                size=len(image_bytes),
                extension=image_ext,
                mime_type=mime_type or "",
                created_by=self._user_id,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_at=naive_utc_now(),
                used=True,
                used_by=self._user_id,
                used_at=naive_utc_now(),
            )
            upload_files.append(upload_file)
            image_map.setdefault((row_idx + 1, col_idx + 1), []).append(
                f"![image]({base_url}/files/{upload_file.id}/file-preview)"
            )

        return image_map, upload_files

    def _get_image_bytes(self, image) -> bytes | None:
        """Return embedded image bytes from an openpyxl image object."""
        data_loader = getattr(image, "_data", None)
        if not callable(data_loader):
            return None

        try:
            return data_loader()
        except Exception:
            logger.warning("Failed to read embedded image bytes from Excel sheet", exc_info=True)
            return None

    def _get_image_extension(self, image) -> str | None:
        """Resolve an image extension from openpyxl metadata."""
        image_format = getattr(image, "format", None)
        if isinstance(image_format, str) and image_format.strip():
            return image_format.strip().lower()

        image_path = getattr(image, "path", None)
        if isinstance(image_path, str):
            _, extension = os.path.splitext(image_path)
            if extension:
                return extension.lstrip(".").lower()

        return None

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
