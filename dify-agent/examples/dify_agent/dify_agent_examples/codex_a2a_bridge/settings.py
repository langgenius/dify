"""Server-owned configuration for the local Codex A2A bridge."""

from __future__ import annotations

import ipaddress
import shutil
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import SecretStr


ALLOWED_SANDBOX_MODES = frozenset({"read-only", "workspace-write"})
ALLOWED_REASONING_EFFORTS = frozenset({"none", "minimal", "low", "medium", "high", "xhigh"})


@dataclass(frozen=True, slots=True, repr=False)
class CodexBridgeSettings:
    """Configuration that callers cannot override through A2A requests."""

    workspace_root: Path
    bind_host: str = "127.0.0.1"
    public_url: str = "http://127.0.0.1:8765"
    allow_insecure_public_url: bool = False
    streaming_enabled: bool = True
    codex_executable: str = "codex"
    model: str | None = "gpt-5.5"
    reasoning_effort: str | None = "xhigh"
    sandbox_mode: str = "workspace-write"
    ignore_user_config: bool = False
    max_concurrent_tasks: int = 1
    cancel_grace_seconds: float = 2.0
    api_token: SecretStr | None = None

    def __post_init__(self) -> None:
        bind_host = self.bind_host.strip()
        if not bind_host:
            raise ValueError("bind_host must not be empty")
        if self.api_token is not None and not self.api_token.get_secret_value():
            raise ValueError("api_token must not be empty")
        if not _is_loopback_host(bind_host) and self.api_token is None:
            raise ValueError("DIFY_BYOA_CODEX_API_TOKEN is required when the bridge binds beyond loopback")
        object.__setattr__(self, "bind_host", bind_host)

        workspace_root = self.workspace_root.expanduser().resolve(strict=True)
        if not workspace_root.is_dir():
            raise ValueError("workspace_root must be an existing directory")
        object.__setattr__(self, "workspace_root", workspace_root)

        executable = shutil.which(self.codex_executable)
        if executable is None:
            raise ValueError("codex_executable was not found or is not executable")
        object.__setattr__(self, "codex_executable", str(Path(executable).resolve(strict=True)))

        public_url = self.public_url.rstrip("/")
        parsed_url = urlsplit(public_url)
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
            raise ValueError("public_url must be an absolute HTTP(S) URL")
        if parsed_url.query or parsed_url.fragment:
            raise ValueError("public_url must not include a query or fragment")
        if parsed_url.path not in {"", "/"}:
            raise ValueError("public_url must not include a path")
        public_host = parsed_url.hostname
        if public_host is None:
            raise ValueError("public_url must include a hostname")
        public_host_is_loopback = _is_loopback_host(public_host)
        if not public_host_is_loopback and parsed_url.scheme != "https" and not self.allow_insecure_public_url:
            raise ValueError(
                "public_url must use HTTPS beyond loopback "
                "(or explicitly enable DIFY_BYOA_CODEX_ALLOW_INSECURE_PUBLIC_URL for trusted development networks)"
            )
        if not public_host_is_loopback and self.api_token is None:
            raise ValueError("DIFY_BYOA_CODEX_API_TOKEN is required when public_url is reachable beyond loopback")
        object.__setattr__(self, "public_url", public_url)

        if self.sandbox_mode not in ALLOWED_SANDBOX_MODES:
            raise ValueError("sandbox_mode must be read-only or workspace-write")
        if self.reasoning_effort is not None and self.reasoning_effort not in ALLOWED_REASONING_EFFORTS:
            raise ValueError("reasoning_effort is not supported by the Codex CLI")
        if self.max_concurrent_tasks < 1:
            raise ValueError("max_concurrent_tasks must be positive")
        if self.cancel_grace_seconds <= 0:
            raise ValueError("cancel_grace_seconds must be positive")


def _is_loopback_host(host: str) -> bool:
    normalized = host.removeprefix("[").removesuffix("]").rstrip(".").lower()
    if normalized == "localhost":
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        # Hostnames are treated as externally reachable unless they are the
        # explicit localhost name. Avoid DNS-based fail-open decisions here.
        return False
