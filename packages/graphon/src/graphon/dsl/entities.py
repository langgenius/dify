from __future__ import annotations

from collections.abc import Mapping
from enum import StrEnum, auto
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class DslKind(StrEnum):
    APP = auto()
    RAG_PIPELINE = auto()
    GRAPH = auto()


class LoadStatus(StrEnum):
    LOADABLE = auto()
    UNSUPPORTED = auto()
    FAILED = auto()


class PluginDependencyType(StrEnum):
    GITHUB = auto()
    MARKETPLACE = auto()
    PACKAGE = auto()


class DslRuntimeVariable(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    value: Any = None
    source: Mapping[str, Any] = Field(default_factory=dict)


class DslRuntimeVariables(BaseModel):
    model_config = ConfigDict(extra="forbid")

    environment_variables: list[DslRuntimeVariable] = Field(default_factory=list)
    conversation_variables: list[DslRuntimeVariable] = Field(default_factory=list)


class DslDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: DslKind
    graph_config: Mapping[str, Any] | None = None
    runtime_variables: DslRuntimeVariables = Field(default_factory=DslRuntimeVariables)


class DslDependency(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: PluginDependencyType
    plugin_unique_identifier: str | None = None
    repo: str | None = None
    package: str | None = None
    source: Mapping[str, Any] = Field(default_factory=dict)


class DslModelCredential(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str | None = None
    vendor: str | None = None
    plugin_unique_identifier: str | None = None
    values: Mapping[str, Any] = Field(default_factory=dict)


class DslToolCredential(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plugin_unique_identifier: str | None = None
    provider_id: str | None = None
    provider: str | None = None
    tool_name: str | None = None
    credential_type: str = "api-key"
    values: Mapping[str, Any] = Field(default_factory=dict)


class DslSlimSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: str = "local"
    plugin_folder: str | None = None
    plugin_root: str | None = None
    plugin_roots: Mapping[str, str] = Field(default_factory=dict)
    daemon_addr: str = ""
    daemon_key: str = ""
    python_path: str = "python3"
    uv_path: str = ""
    python_env_init_timeout: int = 120
    max_execution_timeout: int = 600
    pip_mirror_url: str = ""
    pip_extra_args: str = ""
    marketplace_url: str = "https://marketplace.dify.ai"
    ignore_uv_lock: bool = False


class DslCodeSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    execution_endpoint: str | None = None
    execution_api_key: str | None = None
    ssl_verify: bool = True
    connect_timeout: float = 10.0
    read_timeout: float = 60.0
    write_timeout: float = 10.0
    max_string_length: int = 400_000
    max_number: int | float = 9_223_372_036_854_775_807
    min_number: int | float = -9_223_372_036_854_775_807
    max_precision: int = 20
    max_depth: int = 5
    max_number_array_length: int = 1_000
    max_string_array_length: int = 30
    max_object_array_length: int = 30


class DslCredentials(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_credentials: list[DslModelCredential] = Field(default_factory=list)
    tool_credentials: list[DslToolCredential] = Field(default_factory=list)
    slim: DslSlimSettings = Field(default_factory=DslSlimSettings)
    code: DslCodeSettings = Field(default_factory=DslCodeSettings)


class DslImportPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document: DslDocument
    load_status: LoadStatus
    dependencies: list[DslDependency] = Field(default_factory=list)
    load_reason: str | None = None

    @property
    def loadable(self) -> bool:
        return self.load_status == LoadStatus.LOADABLE
