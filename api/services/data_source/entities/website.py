"""Website source selections and public crawl result contracts."""

from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field


class CrawledPage(BaseModel):
    title: str | None
    description: str | None
    source_url: str | None
    markdown: str | None


class ScrapedPage(BaseModel):
    # Remote page providers may return additional content fields. Keep those fields
    # when generated clients validate the response instead of stripping them.
    model_config = ConfigDict(
        extra="allow",
        json_schema_extra={"x-dify-preserve-unknown-fields": True},
    )

    title: str | None = None
    description: str | None = None
    url: str | None = None
    content: str | None = None


@dataclass(frozen=True, slots=True)
class CrawlStarted:
    status: str
    job_id: str


@dataclass(frozen=True, slots=True)
class PageCrawled:
    status: str
    data: ScrapedPage


@dataclass(frozen=True, slots=True)
class CrawlProgress:
    status: str
    job_id: str
    total: int
    current: int
    data: list[CrawledPage]
    time_consuming: str | float | None = None


@dataclass(frozen=True, slots=True)
class WebsiteJobSelection:
    """A caller-selected job resolved within the current tenant and provider."""

    provider: str
    job_id: str


class WebsiteJobRef(BaseModel):
    """Stable ownership and provider-instance identity for one website crawl job."""

    tenant_id: str
    provider: str
    provider_instance_id: str = Field(pattern=r"^[0-9a-f]{64}$")
    job_id: str
