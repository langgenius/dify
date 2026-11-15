from __future__ import annotations

import shutil
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True, frozen=True)
class SlimLocalSettings:
    folder: Path
    python_path: str = "python3"
    uv_path: str = ""
    python_env_init_timeout: int = 120
    max_execution_timeout: int = 600
    pip_mirror_url: str = ""
    pip_extra_args: str = ""
    marketplace_url: str = "https://marketplace.dify.ai"


@dataclass(slots=True, frozen=True)
class SlimProviderBinding:
    plugin_id: str
    provider: str = ""
    plugin_root: Path | None = None


@dataclass(slots=True)
class SlimConfig:
    bindings: list[SlimProviderBinding]
    local: SlimLocalSettings
    download_timeout_seconds: float = 60.0
    marketplace_download_limit_bytes: int = 15 * 1024 * 1024

    def __post_init__(self) -> None:
        if not self.bindings:
            msg = "SlimConfig.bindings must not be empty."
            raise ValueError(msg)

        python_path = self.local.python_path
        if python_path == "python3":
            python_path = sys.executable

        self.local = SlimLocalSettings(
            folder=self.local.folder.expanduser().resolve(),
            python_path=python_path,
            uv_path=self.local.uv_path or (shutil.which("uv") or ""),
            python_env_init_timeout=self.local.python_env_init_timeout,
            max_execution_timeout=self.local.max_execution_timeout,
            pip_mirror_url=self.local.pip_mirror_url,
            pip_extra_args=self.local.pip_extra_args,
            marketplace_url=self.local.marketplace_url,
        )

        self.bindings = [
            SlimProviderBinding(
                plugin_id=binding.plugin_id,
                provider=binding.provider,
                plugin_root=(
                    binding.plugin_root.expanduser().resolve()
                    if binding.plugin_root is not None
                    else None
                ),
            )
            for binding in self.bindings
        ]
