"""End-to-end tests for the §6 file-output benchmark check stack.

Exercises ``UploadFileContentLoader`` against real ``upload_files`` rows +
storage, then drives ``FileOutputCheckExecutor.check_all`` end-to-end with a
stubbed model invoker so we never hit a real LLM. This proves the I/O
boundary (DB + storage + ExtractProcessor) actually works — unit tests can't
catch a regression where the loader signature drifts from
``ExtractProcessor.load_from_upload_file`` or the executor's file_id
resolution differs from the real ``upload_files`` schema.

Pattern follows ``test_remove_app_and_related_data_task``: seed via
``session_factory.create_session()`` with explicit commits + cleanup by ID
on teardown.
"""

from __future__ import annotations

import uuid
from collections.abc import Generator
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from unittest.mock import patch

import pytest
from sqlalchemy import delete

from core.db.session_factory import session_factory
from core.workflow.nodes.agent_v2.output_check_executor import (
    FileOutputCheckExecutor,
    FileOutputCheckSkipReason,
    FileOutputCheckStatus,
    FileOutputCheckUsage,
    OutputCheckModelInvocationError,
    OutputCheckModelResponse,
)
from core.workflow.nodes.agent_v2.upload_file_content_loader import (
    UploadFileContentLoader,
)
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from models.enums import CreatorUserRole
from models.model import UploadFile


# ──────────────────────────────────────────────────────────────────────────────
# Fixture: real upload_files row + real storage object
# ──────────────────────────────────────────────────────────────────────────────


def _make_upload_file(
    *,
    tenant_id: str,
    created_by: str,
    name: str,
    extension: str,
    content: bytes,
) -> UploadFile:
    """Build (without persisting) an ``UploadFile`` row + its storage key.

    ``UploadFile.__init__`` allocates a fresh UUID for ``.id``; we then
    derive the storage key from it so the row + the blob agree.
    """
    upload = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.OPENDAL,
        key="placeholder",  # overwritten below once we know the generated id
        name=name,
        size=len(content),
        extension=extension,
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=created_by,
        created_at=datetime.now(UTC),
        used=False,
    )
    upload.key = f"upload_files/{tenant_id}/{upload.id}.{extension}"
    return upload


@pytest.fixture
def stored_text_file(
    flask_req_ctx,
) -> Generator[tuple[UploadFile, str], None, None]:
    """Seed one real ``upload_files`` row + write its content to storage.

    Yields ``(upload_file, content_text)``. Cleans up DB row and the storage
    object on teardown so we never leave debris.
    """
    tenant_id = str(uuid.uuid4())
    created_by = str(uuid.uuid4())
    content_text = "This is the benchmark contract.\nIt has multiple lines.\nLine 3."
    upload = _make_upload_file(
        tenant_id=tenant_id,
        created_by=created_by,
        name="benchmark.txt",
        extension="txt",
        content=content_text.encode("utf-8"),
    )
    storage.save(upload.key, content_text.encode("utf-8"))
    with session_factory.create_session() as session:
        session.add(upload)
        session.commit()
        upload_id, upload_key = upload.id, upload.key

    try:
        yield upload, content_text
    finally:
        try:
            storage.delete(upload_key)
        except Exception:  # noqa: BLE001 — best-effort
            pass
        with session_factory.create_session() as session:
            session.execute(delete(UploadFile).where(UploadFile.id == upload_id))
            session.commit()


@pytest.fixture
def two_stored_files(
    flask_req_ctx,
) -> Generator[tuple[UploadFile, UploadFile, str, str], None, None]:
    """Two real ``upload_files`` rows — produced + benchmark — for executor
    end-to-end coverage."""
    tenant_id = str(uuid.uuid4())
    created_by = str(uuid.uuid4())

    benchmark_text = "Required sections: introduction, methodology, results, conclusion."
    produced_text = "introduction\n\nmethodology\n\nresults\n\nconclusion\n\nsign-off"

    benchmark = _make_upload_file(
        tenant_id=tenant_id,
        created_by=created_by,
        name="benchmark.md",
        extension="md",
        content=benchmark_text.encode("utf-8"),
    )
    produced = _make_upload_file(
        tenant_id=tenant_id,
        created_by=created_by,
        name="produced.md",
        extension="md",
        content=produced_text.encode("utf-8"),
    )

    storage.save(benchmark.key, benchmark_text.encode("utf-8"))
    storage.save(produced.key, produced_text.encode("utf-8"))
    with session_factory.create_session() as session:
        session.add(benchmark)
        session.add(produced)
        session.commit()
        keys = [benchmark.key, produced.key]
        ids = [benchmark.id, produced.id]

    try:
        yield benchmark, produced, benchmark_text, produced_text
    finally:
        for k in keys:
            try:
                storage.delete(k)
            except Exception:  # noqa: BLE001
                pass
        with session_factory.create_session() as session:
            session.execute(delete(UploadFile).where(UploadFile.id.in_(ids)))
            session.commit()


# ──────────────────────────────────────────────────────────────────────────────
# UploadFileContentLoader against real DB + real storage
# ──────────────────────────────────────────────────────────────────────────────


def test_upload_file_content_loader_extracts_text_for_real_upload_file(stored_text_file):
    loader = UploadFileContentLoader()
    upload, content_text = stored_text_file
    loaded = loader.load(file_id=upload.id, tenant_id=upload.tenant_id)
    assert loaded is not None
    assert loaded.unsupported is False
    # ExtractProcessor for ``.txt`` uses TextExtractor; content should round-trip.
    assert content_text.split("\n")[0] in loaded.text


def test_upload_file_content_loader_rejects_cross_tenant_access(stored_text_file):
    loader = UploadFileContentLoader()
    upload, _ = stored_text_file
    intruder_tenant = str(uuid.uuid4())
    assert loader.load(file_id=upload.id, tenant_id=intruder_tenant) is None


def test_upload_file_content_loader_short_circuits_unsupported_extension(flask_req_ctx):
    """Image extensions never reach storage; verify the short-circuit holds
    against a real ``upload_files`` row."""
    tenant_id = str(uuid.uuid4())
    upload = _make_upload_file(
        tenant_id=tenant_id,
        created_by=str(uuid.uuid4()),
        name="photo.png",
        extension="png",
        content=b"\x89PNG\r\n...",
    )
    with session_factory.create_session() as session:
        session.add(upload)
        session.commit()
        upload_id = upload.id

    try:
        loader = UploadFileContentLoader()
        loaded = loader.load(file_id=upload_id, tenant_id=tenant_id)
        assert loaded is not None
        assert loaded.unsupported is True
        assert loaded.text == ""
    finally:
        with session_factory.create_session() as session:
            session.execute(delete(UploadFile).where(UploadFile.id == upload_id))
            session.commit()


def test_upload_file_content_loader_handles_missing_file_id_gracefully():
    """Unknown UUID just returns ``None`` — never raises."""
    loader = UploadFileContentLoader()
    assert loader.load(file_id=str(uuid.uuid4()), tenant_id=str(uuid.uuid4())) is None


# ──────────────────────────────────────────────────────────────────────────────
# FileOutputCheckExecutor with real DB-backed loader + stubbed invoker
# ──────────────────────────────────────────────────────────────────────────────


def _patch_extraction_to_text(monkey_text: str):
    """Substitute ``ExtractProcessor.load_from_upload_file`` to a deterministic
    string so the test does not rely on the ``unstructured`` / ETL stack being
    fully wired in the integration env (the ``.md`` extractor calls into the
    Markdown parser which may not be initialised here)."""
    return patch(
        "core.workflow.nodes.agent_v2.upload_file_content_loader.ExtractProcessor.load_from_upload_file",
        return_value=monkey_text,
    )


class _PassingStubInvoker:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def invoke(self, **kwargs: Any) -> OutputCheckModelResponse:
        self.calls.append(kwargs)
        return OutputCheckModelResponse(
            text="VERDICT: PASS\nREASON: All required sections present.",
            usage=FileOutputCheckUsage(
                prompt_tokens=42,
                completion_tokens=8,
                total_tokens=50,
                total_price=Decimal("0.001"),
                latency_ms=120,
            ),
        )


class _FailingStubInvoker:
    def invoke(self, **_kwargs: Any) -> OutputCheckModelResponse:
        return OutputCheckModelResponse(
            text="VERDICT: FAIL\nREASON: Missing methodology section.",
            usage=FileOutputCheckUsage(prompt_tokens=20, completion_tokens=5, total_tokens=25),
        )


class _RaisingStubInvoker:
    def invoke(self, **_kwargs: Any) -> OutputCheckModelResponse:
        raise OutputCheckModelInvocationError("simulated provider outage")


def _declared_file_output(name: str, benchmark_file_id: str):
    """Construct a declared output that opts into output check, pointing at
    the supplied benchmark file id."""
    from models.agent_config_entities import (
        DeclaredOutputCheckConfig,
        DeclaredOutputConfig,
        DeclaredOutputType,
    )

    return DeclaredOutputConfig(
        name=name,
        type=DeclaredOutputType.FILE,
        check=DeclaredOutputCheckConfig(
            enabled=True,
            prompt="Verify the produced file matches the benchmark structure.",
            benchmark_file_ref={"file_id": benchmark_file_id},
        ),
    )


def test_executor_passes_through_real_db_when_model_says_pass(two_stored_files):
    benchmark, produced, benchmark_text, produced_text = two_stored_files
    invoker = _PassingStubInvoker()
    executor = FileOutputCheckExecutor(
        content_loader=UploadFileContentLoader(),
        model_invoker=invoker,
    )

    with _patch_extraction_to_text("__loader_text__"):
        outcome = executor.check_all(
            declared_outputs=[_declared_file_output("report", benchmark.id)],
            raw_output={"report": {"file_id": produced.id}},
            tenant_id=benchmark.tenant_id,
            model_provider="openai",
            model_name="gpt-4",
        )

    assert len(outcome.results) == 1
    result = outcome.results[0]
    assert result.status == FileOutputCheckStatus.PASSED
    assert result.reason == "All required sections present."
    assert result.usage.total_tokens == 50
    # Usage should be propagated end-to-end; verify the aggregate too.
    assert outcome.total_usage.total_tokens == 50
    # The invoker received a prompt that embeds both files' content.
    assert "__loader_text__" in invoker.calls[0]["prompt"]


def test_executor_fails_through_real_db_when_model_says_fail(two_stored_files):
    benchmark, produced, _, _ = two_stored_files
    executor = FileOutputCheckExecutor(
        content_loader=UploadFileContentLoader(),
        model_invoker=_FailingStubInvoker(),
    )
    with _patch_extraction_to_text("__loader_text__"):
        outcome = executor.check_all(
            declared_outputs=[_declared_file_output("report", benchmark.id)],
            raw_output={"report": {"file_id": produced.id}},
            tenant_id=benchmark.tenant_id,
            model_provider="openai",
            model_name="gpt-4",
        )
    assert outcome.has_failures
    result = outcome.results[0]
    assert result.status == FileOutputCheckStatus.FAILED
    assert "Missing methodology" in result.reason


def test_executor_skips_when_produced_file_inaccessible(two_stored_files):
    """Produced file id doesn't exist in DB → SKIPPED with PRODUCED_FILE_MISSING."""
    benchmark, _, _, _ = two_stored_files
    executor = FileOutputCheckExecutor(
        content_loader=UploadFileContentLoader(),
        model_invoker=_PassingStubInvoker(),
    )
    outcome = executor.check_all(
        declared_outputs=[_declared_file_output("report", benchmark.id)],
        raw_output={"report": {"file_id": str(uuid.uuid4())}},  # phantom file
        tenant_id=benchmark.tenant_id,
        model_provider="openai",
        model_name="gpt-4",
    )
    assert outcome.results[0].status == FileOutputCheckStatus.SKIPPED
    assert outcome.results[0].skip_reason == FileOutputCheckSkipReason.PRODUCED_FILE_MISSING


def test_executor_skips_when_benchmark_file_cross_tenant(two_stored_files):
    """Benchmark file owned by another tenant → SKIPPED with BENCHMARK_FILE_NOT_ACCESSIBLE."""
    benchmark, produced, _, _ = two_stored_files
    executor = FileOutputCheckExecutor(
        content_loader=UploadFileContentLoader(),
        model_invoker=_PassingStubInvoker(),
    )
    intruder_tenant = str(uuid.uuid4())
    outcome = executor.check_all(
        declared_outputs=[_declared_file_output("report", benchmark.id)],
        raw_output={"report": {"file_id": produced.id}},
        tenant_id=intruder_tenant,  # mismatch → loader returns None for both files
        model_provider="openai",
        model_name="gpt-4",
    )
    # Either produced or benchmark resolves first to None; either way the
    # result is a SKIPPED row.
    assert outcome.results[0].status == FileOutputCheckStatus.SKIPPED


def test_executor_skips_when_model_invoker_raises(two_stored_files):
    """Provider outage → SKIPPED with MODEL_INVOCATION_ERROR."""
    benchmark, produced, _, _ = two_stored_files
    executor = FileOutputCheckExecutor(
        content_loader=UploadFileContentLoader(),
        model_invoker=_RaisingStubInvoker(),
    )
    with _patch_extraction_to_text("__loader_text__"):
        outcome = executor.check_all(
            declared_outputs=[_declared_file_output("report", benchmark.id)],
            raw_output={"report": {"file_id": produced.id}},
            tenant_id=benchmark.tenant_id,
            model_provider="openai",
            model_name="gpt-4",
        )
    result = outcome.results[0]
    assert result.status == FileOutputCheckStatus.SKIPPED
    assert result.skip_reason == FileOutputCheckSkipReason.MODEL_INVOCATION_ERROR
    assert "simulated provider outage" in result.reason
