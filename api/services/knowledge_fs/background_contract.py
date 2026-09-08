"""Small, typed Celery locators. Runtime scope is reloaded from the KnowledgeFS database."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

DOCUMENT_QUEUE = "knowledge_fs_document"
SOURCE_QUEUE = "knowledge_fs_source"
RESEARCH_QUEUE = "knowledge_fs_research"
MAINTENANCE_QUEUE = "knowledge_fs_maintenance"
DISPATCH_QUEUE = "knowledge_fs_dispatch"
DELIVERY_TASK = "tasks.knowledge_fs_background_tasks.execute_delivery"
OPERATION_TASK = "tasks.knowledge_fs_background_tasks.execute_operation"

# Database-owned bounded sweeps are separate from document broker messages. In particular a source
# workflow must never occupy the only worker capable of completing its child compilation.
OPERATION_QUEUES = {
    "document.dispatch": DISPATCH_QUEUE,
    "document.reconcile": MAINTENANCE_QUEUE,
    "document.semantic": DOCUMENT_QUEUE,
    "page-index.repair": DOCUMENT_QUEUE,
    "page-index.upgrade": MAINTENANCE_QUEUE,
    "legacy.bootstrap": MAINTENANCE_QUEUE,
    "profile.migrate": DOCUMENT_QUEUE,
    "profile.backfill": MAINTENANCE_QUEUE,
    "fts.backfill": MAINTENANCE_QUEUE,
    "research.execute": RESEARCH_QUEUE,
    "deletion.dispatch": DISPATCH_QUEUE,
    "deletion.execute": MAINTENANCE_QUEUE,
    "upload.cleanup": MAINTENANCE_QUEUE,
    "source.execute": SOURCE_QUEUE,
    "source.schedule": DISPATCH_QUEUE,
    "source.preview": SOURCE_QUEUE,
    "source.legacy-sync": SOURCE_QUEUE,
    "quality.replay": RESEARCH_QUEUE,
}


class CompilationLocator(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attemptId: UUID


class FindabilityLocator(BaseModel):
    model_config = ConfigDict(extra="forbid")
    compilationAttemptId: UUID
    publicationFingerprint: str = Field(min_length=1, max_length=128)


class BackgroundJobPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    type: Literal["document.compile", "quality.page-index-findability"]
    payload: CompilationLocator | FindabilityLocator
    attempts: int = Field(default=1, ge=1, le=100_000, strict=True)
    runAfter: int | None = Field(default=None, ge=0, le=2**53 - 1, strict=True)

    @model_validator(mode="after")
    def validate_locator_kind(self) -> "BackgroundJobPayload":
        expected = CompilationLocator if self.type == "document.compile" else FindabilityLocator
        if not isinstance(self.payload, expected):
            raise ValueError("The locator does not match the background job type")
        return self
