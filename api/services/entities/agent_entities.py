from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from models.agent import AgentIconType
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig


class ComposerVariant(StrEnum):
    WORKFLOW = "workflow"
    AGENT_APP = "agent_app"


class ComposerSaveStrategy(StrEnum):
    NODE_JOB_ONLY = "node_job_only"
    SAVE_TO_CURRENT_VERSION = "save_to_current_version"
    SAVE_AS_NEW_VERSION = "save_as_new_version"
    SAVE_AS_NEW_AGENT = "save_as_new_agent"
    SAVE_TO_ROSTER = "save_to_roster"


class ComposerBindingPayload(BaseModel):
    binding_type: Literal["roster_agent", "inline_agent"]
    agent_id: str | None = None
    current_snapshot_id: str | None = None


class ComposerSoulLockPayload(BaseModel):
    locked: bool = True
    unlocked_from_version_id: str | None = None


class ComposerSavePayload(BaseModel):
    variant: ComposerVariant
    binding: ComposerBindingPayload | None = None
    soul_lock: ComposerSoulLockPayload = Field(default_factory=ComposerSoulLockPayload)
    agent_soul: AgentSoulConfig | None = None
    node_job: WorkflowNodeJobConfig | None = None
    save_strategy: ComposerSaveStrategy
    version_note: str | None = None
    idempotency_key: str | None = None
    client_revision_id: str | None = None
    new_agent_name: str | None = Field(default=None, min_length=1, max_length=255)

    @model_validator(mode="after")
    def validate_variant_sections(self) -> "ComposerSavePayload":
        if self.variant == ComposerVariant.AGENT_APP and self.node_job is not None:
            raise ValueError("Agent App Variant must not include workflow node job config")
        if self.variant == ComposerVariant.AGENT_APP and self.agent_soul is not None:
            if self.agent_soul.app_variables and self.save_strategy == ComposerSaveStrategy.NODE_JOB_ONLY:
                raise ValueError("Agent App Variant cannot use node_job_only save strategy")
        if self.variant == ComposerVariant.WORKFLOW and self.agent_soul is not None:
            if self.agent_soul.app_variables:
                raise ValueError("Workflow Variant must not include app variables")
            if self.agent_soul.app_features:
                raise ValueError("Workflow Variant must not include app features")
        return self


class RosterAgentCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    mode: Literal["agent"] = "agent"
    description: str = ""
    role: str = Field(default="", max_length=255)
    icon_type: AgentIconType | None = None
    icon: str | None = Field(default=None, max_length=255)
    icon_background: str | None = Field(default=None, max_length=255)
    agent_soul: AgentSoulConfig = Field(default_factory=AgentSoulConfig)
    version_note: str | None = None


class RosterAgentUpdatePayload(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    role: str | None = Field(default=None, max_length=255)
    icon_type: AgentIconType | None = None
    icon: str | None = Field(default=None, max_length=255)
    icon_background: str | None = Field(default=None, max_length=255)


class RosterListQuery(BaseModel):
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=20, ge=1, le=100)
    keyword: str | None = None


class ComposerCandidateCapabilities(BaseModel):
    human_roster_available: bool = False


class ComposerCandidatesResponse(BaseModel):
    variant: ComposerVariant
    allowed_node_job_candidates: dict[str, Any] = Field(default_factory=dict)
    allowed_soul_candidates: dict[str, Any] = Field(default_factory=dict)
    capabilities: ComposerCandidateCapabilities = Field(default_factory=ComposerCandidateCapabilities)
    # True when any candidate list was clipped to the per-list cap (ENG-615 §3.3).
    truncated: bool = False
