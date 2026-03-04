"""
Export app messages to JSONL.GZ format.

Outputs: conversation_id, message_id, query, answer, inputs (raw JSON),
retriever_resources (from message_metadata), feedback (user feedbacks array).

Uses (created_at, id) cursor pagination and batch-loads feedbacks to avoid N+1.
Does NOT touch Message.inputs / Message.user_feedback properties.
"""

import datetime
import gzip
import json
import logging
import tempfile
from collections import defaultdict
from collections.abc import Generator, Iterable
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO, cast

import orjson
import sqlalchemy as sa
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session

from extensions.ext_database import db
from extensions.ext_storage import storage
from models.model import Message, MessageFeedback

logger = logging.getLogger(__name__)

MAX_FILENAME_BASE_LENGTH = 1024
FORBIDDEN_FILENAME_SUFFIXES = (".jsonl.gz", ".jsonl", ".gz")


class AppMessageExportFeedback(BaseModel):
    id: str
    app_id: str
    conversation_id: str
    message_id: str
    rating: str
    content: str | None = None
    from_source: str
    from_end_user_id: str | None = None
    from_account_id: str | None = None
    created_at: str
    updated_at: str

    model_config = ConfigDict(extra="forbid")


class AppMessageExportRecord(BaseModel):
    conversation_id: str
    message_id: str
    query: str
    answer: str
    inputs: dict[str, Any]
    retriever_resources: list[Any] = Field(default_factory=list)
    feedback: list[AppMessageExportFeedback] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


class AppMessageExportStats(BaseModel):
    batches: int = 0
    total_messages: int = 0
    messages_with_feedback: int = 0
    total_feedbacks: int = 0

    model_config = ConfigDict(extra="forbid")


class AppMessageExportService:
    @staticmethod
    def validate_export_filename(filename: str) -> str:
        normalized = filename.strip()
        if not normalized:
            raise ValueError("--filename must not be empty.")

        normalized_lower = normalized.lower()
        if normalized_lower.endswith(FORBIDDEN_FILENAME_SUFFIXES):
            raise ValueError("--filename must not include .jsonl.gz/.jsonl/.gz suffix; pass base filename only.")

        if normalized.startswith("/"):
            raise ValueError("--filename must be a relative path; absolute paths are not allowed.")

        if "\\" in normalized:
            raise ValueError("--filename must use '/' as path separator; '\\' is not allowed.")

        if "//" in normalized:
            raise ValueError("--filename must not contain empty path segments ('//').")

        if len(normalized) > MAX_FILENAME_BASE_LENGTH:
            raise ValueError(f"--filename is too long; max length is {MAX_FILENAME_BASE_LENGTH}.")

        for ch in normalized:
            if ch == "\x00" or ord(ch) < 32 or ord(ch) == 127:
                raise ValueError("--filename must not contain control characters or NUL.")

        parts = PurePosixPath(normalized).parts
        if not parts:
            raise ValueError("--filename must include a file name.")

        if any(part in (".", "..") for part in parts):
            raise ValueError("--filename must not contain '.' or '..' path segments.")

        return normalized

    @property
    def output_gz_name(self) -> str:
        return f"{self._filename_base}.jsonl.gz"

    @property
    def output_jsonl_name(self) -> str:
        return f"{self._filename_base}.jsonl"

    def __init__(
        self,
        app_id: str,
        end_before: datetime.datetime,
        filename: str,
        *,
        start_from: datetime.datetime | None = None,
        batch_size: int = 1000,
        use_cloud_storage: bool = False,
        dry_run: bool = False,
    ) -> None:
        if start_from and start_from >= end_before:
            raise ValueError(f"start_from ({start_from}) must be before end_before ({end_before})")

        self._app_id = app_id
        self._end_before = end_before
        self._start_from = start_from
        self._filename_base = self.validate_export_filename(filename)
        self._batch_size = batch_size
        self._use_cloud_storage = use_cloud_storage
        self._dry_run = dry_run

    def run(self) -> AppMessageExportStats:
        stats = AppMessageExportStats()

        logger.info(
            "export_app_messages: app_id=%s, start_from=%s, end_before=%s, dry_run=%s, cloud=%s, output_gz=%s",
            self._app_id,
            self._start_from,
            self._end_before,
            self._dry_run,
            self._use_cloud_storage,
            self.output_gz_name,
        )

        if self._dry_run:
            for _ in self._iter_records_with_stats(stats):
                pass
            self._finalize_stats(stats)
            return stats

        if self._use_cloud_storage:
            self._export_to_cloud(stats)
        else:
            self._export_to_local(stats)

        self._finalize_stats(stats)
        return stats

    def iter_records(self) -> Generator[AppMessageExportRecord, None, None]:
        for batch in self._iter_record_batches():
            yield from batch

    @staticmethod
    def write_jsonl_gz(records: Iterable[AppMessageExportRecord], fileobj: BinaryIO) -> None:
        with gzip.GzipFile(fileobj=fileobj, mode="wb") as gz:
            for record in records:
                gz.write(orjson.dumps(record.model_dump(mode="json")) + b"\n")

    def _export_to_local(self, stats: AppMessageExportStats) -> None:
        output_path = Path.cwd() / self.output_gz_name
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("wb") as output_file:
            self.write_jsonl_gz(self._iter_records_with_stats(stats), output_file)

    def _export_to_cloud(self, stats: AppMessageExportStats) -> None:
        with tempfile.SpooledTemporaryFile(max_size=64 * 1024 * 1024) as tmp:
            self.write_jsonl_gz(self._iter_records_with_stats(stats), cast(BinaryIO, tmp))
            tmp.seek(0)
            data = tmp.read()

        storage.save(self.output_gz_name, data)
        logger.info("export_app_messages: uploaded %d bytes to cloud key=%s", len(data), self.output_gz_name)

    def _iter_records_with_stats(self, stats: AppMessageExportStats) -> Generator[AppMessageExportRecord, None, None]:
        for record in self.iter_records():
            self._update_stats(stats, record)
            yield record

    @staticmethod
    def _update_stats(stats: AppMessageExportStats, record: AppMessageExportRecord) -> None:
        stats.total_messages += 1
        if record.feedback:
            stats.messages_with_feedback += 1
            stats.total_feedbacks += len(record.feedback)

    def _finalize_stats(self, stats: AppMessageExportStats) -> None:
        if stats.total_messages == 0:
            stats.batches = 0
            return
        stats.batches = (stats.total_messages + self._batch_size - 1) // self._batch_size

    def _iter_record_batches(self) -> Generator[list[AppMessageExportRecord], None, None]:
        cursor: tuple[datetime.datetime, str] | None = None
        while True:
            rows, cursor = self._fetch_batch(cursor)
            if not rows:
                break

            message_ids = [str(row.id) for row in rows]
            feedbacks_map = self._fetch_feedbacks(message_ids)
            yield [self._build_record(row, feedbacks_map) for row in rows]

    def _fetch_batch(
        self, cursor: tuple[datetime.datetime, str] | None
    ) -> tuple[list[Any], tuple[datetime.datetime, str] | None]:
        with Session(db.engine, expire_on_commit=False) as session:
            stmt = (
                select(
                    Message.id,
                    Message.conversation_id,
                    Message.query,
                    Message.answer,
                    Message._inputs,  # pyright: ignore[reportPrivateUsage]
                    Message.message_metadata,
                    Message.created_at,
                )
                .where(
                    Message.app_id == self._app_id,
                    Message.created_at < self._end_before,
                )
                .order_by(Message.created_at, Message.id)
                .limit(self._batch_size)
            )

            if self._start_from:
                stmt = stmt.where(Message.created_at >= self._start_from)

            if cursor:
                stmt = stmt.where(
                    tuple_(Message.created_at, Message.id)
                    > tuple_(
                        sa.literal(cursor[0], type_=sa.DateTime()),
                        sa.literal(cursor[1], type_=Message.id.type),
                    )
                )

            rows = list(session.execute(stmt).all())

        if not rows:
            return [], cursor

        last = rows[-1]
        return rows, (last.created_at, last.id)

    def _fetch_feedbacks(self, message_ids: list[str]) -> dict[str, list[AppMessageExportFeedback]]:
        if not message_ids:
            return {}

        with Session(db.engine, expire_on_commit=False) as session:
            stmt = (
                select(MessageFeedback)
                .where(
                    MessageFeedback.message_id.in_(message_ids),
                    MessageFeedback.from_source == "user",
                )
                .order_by(MessageFeedback.message_id, MessageFeedback.created_at)
            )
            feedbacks = list(session.scalars(stmt).all())

        result: dict[str, list[AppMessageExportFeedback]] = defaultdict(list)
        for feedback in feedbacks:
            result[str(feedback.message_id)].append(AppMessageExportFeedback.model_validate(feedback.to_dict()))
        return result

    @staticmethod
    def _build_record(row: Any, feedbacks_map: dict[str, list[AppMessageExportFeedback]]) -> AppMessageExportRecord:
        retriever_resources: list[Any] = []
        if row.message_metadata:
            try:
                metadata = json.loads(row.message_metadata)
                value = metadata.get("retriever_resources", [])
                if isinstance(value, list):
                    retriever_resources = value
            except (json.JSONDecodeError, TypeError):
                pass

        message_id = str(row.id)
        return AppMessageExportRecord(
            conversation_id=str(row.conversation_id),
            message_id=message_id,
            query=row.query,
            answer=row.answer,
            inputs=row._inputs if isinstance(row._inputs, dict) else {},
            retriever_resources=retriever_resources,
            feedback=feedbacks_map.get(message_id, []),
        )
