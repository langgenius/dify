from __future__ import annotations

from pydantic import AnyHttpUrl, BaseModel


class SandboxContext(BaseModel):
    """Typed context for sandbox integration. All fields optional by design."""

    sandbox_url: AnyHttpUrl | None = None
    sandbox_token: str | None = None


__all__ = ["SandboxContext"]
