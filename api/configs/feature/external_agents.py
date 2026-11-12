"""Deployment controls for the frozen External Agent HTTP+JSON profile."""

from pydantic import Field
from pydantic_settings import BaseSettings


class ExternalAgentsConfig(BaseSettings):
    EXTERNAL_AGENTS_ENABLED: bool = False
    EXTERNAL_AGENTS_QUEUE: str = "external_agents"
    EXTERNAL_AGENTS_POLL_SECONDS: int = Field(default=5, ge=1, le=60)
    EXTERNAL_AGENTS_LOGICAL_BUDGET_SECONDS: int = Field(default=3600, ge=60)
    EXTERNAL_AGENTS_HTTP_CONNECT_SECONDS: int = Field(default=5, ge=1, le=30)
    EXTERNAL_AGENTS_HTTP_TIMEOUT_SECONDS: int = Field(default=30, ge=1, le=30)
    EXTERNAL_AGENTS_SSE_WINDOW_SECONDS: int = Field(default=30, ge=1, le=30)
    EXTERNAL_AGENTS_CANCEL_WINDOW_SECONDS: int = Field(default=30, ge=1, le=60)
    EXTERNAL_AGENTS_TRACKING_SECONDS: int = Field(default=86400, ge=60, le=86400)
    EXTERNAL_AGENTS_BACKGROUND_INITIAL_SECONDS: int = Field(default=60, ge=1, le=300)
    EXTERNAL_AGENTS_BACKGROUND_MAX_SECONDS: int = Field(default=300, ge=1, le=300)
    EXTERNAL_AGENTS_BACKGROUND_MAX_QUERIES: int = Field(default=300, ge=1, le=300)
    EXTERNAL_AGENTS_WORKSPACE_QUERY_CONCURRENCY: int = Field(default=20, ge=1)
    EXTERNAL_AGENTS_ENDPOINT_QUERY_CONCURRENCY: int = Field(default=5, ge=1)
    EXTERNAL_AGENTS_IO_CONCURRENCY: int = Field(default=32, ge=1)
    EXTERNAL_AGENTS_MAX_FILES: int = Field(default=5, ge=1, le=5)
    EXTERNAL_AGENTS_DOCUMENT_BYTES: int = Field(default=15 * 1024 * 1024, ge=0, le=15 * 1024 * 1024)
    EXTERNAL_AGENTS_IMAGE_BYTES: int = Field(default=10 * 1024 * 1024, ge=0, le=10 * 1024 * 1024)
    EXTERNAL_AGENTS_TOTAL_FILE_BYTES: int = Field(default=30 * 1024 * 1024, ge=0, le=30 * 1024 * 1024)
    EXTERNAL_AGENTS_WORKER_BATCH: int = Field(default=100, ge=1, le=1000)
    EXTERNAL_AGENTS_SWEEP_SECONDS: int = Field(default=60, ge=1, le=300)
