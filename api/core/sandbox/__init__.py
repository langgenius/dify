from __future__ import annotations

import importlib
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .bash.dify_cli import (
        DifyCliBinary,
        DifyCliConfig,
        DifyCliEnvConfig,
        DifyCliLocator,
        DifyCliToolConfig,
    )
    from .bash.session import SandboxBashSession
    from .builder import SandboxBuilder, VMConfig
    from .entities import AppAssets, DifyCli, SandboxProviderApiEntity, SandboxType
    from .initializer import (
        AsyncSandboxInitializer,
        SandboxInitializer,
        SyncSandboxInitializer,
    )
    from .initializer.app_assets_initializer import AppAssetsInitializer
    from .initializer.dify_cli_initializer import DifyCliInitializer
    from .initializer.draft_app_assets_initializer import DraftAppAssetsInitializer
    from .manager import SandboxManager
    from .sandbox import Sandbox
    from .storage import ArchiveSandboxStorage, SandboxStorage
    from .utils.debug import sandbox_debug
    from .utils.encryption import create_sandbox_config_encrypter, masked_config

__all__ = [
    "AppAssets",
    "AppAssetsInitializer",
    "ArchiveSandboxStorage",
    "AsyncSandboxInitializer",
    "DifyCli",
    "DifyCliBinary",
    "DifyCliConfig",
    "DifyCliEnvConfig",
    "DifyCliInitializer",
    "DifyCliLocator",
    "DifyCliToolConfig",
    "DraftAppAssetsInitializer",
    "Sandbox",
    "SandboxBashSession",
    "SandboxBuilder",
    "SandboxInitializer",
    "SandboxManager",
    "SandboxProviderApiEntity",
    "SandboxStorage",
    "SandboxType",
    "SyncSandboxInitializer",
    "VMConfig",
    "create_sandbox_config_encrypter",
    "masked_config",
    "sandbox_debug",
]

_LAZY_IMPORTS = {
    "AppAssets": ("core.sandbox.entities", "AppAssets"),
    "AppAssetsInitializer": ("core.sandbox.initializer.app_assets_initializer", "AppAssetsInitializer"),
    "AsyncSandboxInitializer": ("core.sandbox.initializer", "AsyncSandboxInitializer"),
    "ArchiveSandboxStorage": ("core.sandbox.storage", "ArchiveSandboxStorage"),
    "DifyCli": ("core.sandbox.entities", "DifyCli"),
    "DifyCliBinary": ("core.sandbox.bash.dify_cli", "DifyCliBinary"),
    "DifyCliConfig": ("core.sandbox.bash.dify_cli", "DifyCliConfig"),
    "DifyCliEnvConfig": ("core.sandbox.bash.dify_cli", "DifyCliEnvConfig"),
    "DifyCliInitializer": ("core.sandbox.initializer.dify_cli_initializer", "DifyCliInitializer"),
    "DifyCliLocator": ("core.sandbox.bash.dify_cli", "DifyCliLocator"),
    "DifyCliToolConfig": ("core.sandbox.bash.dify_cli", "DifyCliToolConfig"),
    "DraftAppAssetsInitializer": ("core.sandbox.initializer.draft_app_assets_initializer", "DraftAppAssetsInitializer"),
    "Sandbox": ("core.sandbox.sandbox", "Sandbox"),
    "SandboxBashSession": ("core.sandbox.bash.session", "SandboxBashSession"),
    "SandboxBuilder": ("core.sandbox.builder", "SandboxBuilder"),
    "SandboxInitializer": ("core.sandbox.initializer", "SandboxInitializer"),
    "SandboxManager": ("core.sandbox.manager", "SandboxManager"),
    "SandboxProviderApiEntity": ("core.sandbox.entities", "SandboxProviderApiEntity"),
    "SandboxStorage": ("core.sandbox.storage", "SandboxStorage"),
    "SandboxType": ("core.sandbox.entities", "SandboxType"),
    "SyncSandboxInitializer": ("core.sandbox.initializer", "SyncSandboxInitializer"),
    "VMConfig": ("core.sandbox.builder", "VMConfig"),
    "create_sandbox_config_encrypter": ("core.sandbox.utils.encryption", "create_sandbox_config_encrypter"),
    "masked_config": ("core.sandbox.utils.encryption", "masked_config"),
    "sandbox_debug": ("core.sandbox.utils.debug", "sandbox_debug"),
}


def __getattr__(name: str):
    if name not in _LAZY_IMPORTS:
        raise AttributeError(f"module 'core.sandbox' has no attribute {name}")
    module_path, attr_name = _LAZY_IMPORTS[name]
    module = importlib.import_module(module_path)
    value = getattr(module, attr_name)
    globals()[name] = value
    return value
