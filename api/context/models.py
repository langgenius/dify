from __future__ import annotations

from pydantic import AnyHttpUrl, BaseModel


class SandboxContext(BaseModel):
    """Typed context for sandbox integration. All fields optional by design."""

    sandbox_url: AnyHttpUrl = None
    sandbox_token: str = None  # optional, if later needed for auth


__all__ = ["SandboxContext"]
