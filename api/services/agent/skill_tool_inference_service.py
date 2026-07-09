"""Infer CLI tool + ENV suggestions from a standardized skill (ENG-371).

Reads the skill's SKILL.md from the agent drive, asks the tenant's default
reasoning model once (a plain LLM call, never an agent run), and returns
*draft* suggestions only — nothing is persisted here. The frontend prefills
the TOOLS box (``inferred from <skill>`` badge) and the Pre-Authorize ENV
panel, and saving still goes through the composer's full shell/env/secret/
dangerous-command validation, so inference opens no bypass.

ENV suggestions carry only ``key`` + ``reason`` — the model never produces a
value; users fill those in themselves and the runtime injects ``$VAR`` only.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import json_repair
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from core.errors.error import ProviderTokenNotInitError
from core.model_manager import ModelManager
from graphon.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType
from services.agent_drive_service import AgentDriveError, AgentDriveService

logger = logging.getLogger(__name__)


class SkillToolInferenceError(Exception):
    """Stable-code error for the infer-tools endpoint."""

    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class EnvSuggestion(BaseModel):
    key: str
    reason: str = ""
    secret_likely: bool = False


class CliToolSuggestion(BaseModel):
    name: str
    description: str = ""
    command: str = ""
    install_commands: list[str] = Field(default_factory=list)
    env_suggestions: list[EnvSuggestion] = Field(default_factory=list)
    inferred_from: str = ""


class SkillToolInferenceResult(BaseModel):
    inferable: bool
    cli_tools: list[CliToolSuggestion] = Field(default_factory=list)
    reason: str | None = None


_SYSTEM_PROMPT = """\
You analyze an agent skill document (SKILL.md) and infer which command-line \
tools the skill depends on at runtime, so a user can pre-install them in the \
agent's sandbox.

Rules:
- Only suggest tools the document explicitly uses or clearly requires; never guess.
- For each tool give: name, a one-line reason-style description referencing the \
document, the base command, and install commands for a Debian-based sandbox \
(apt-get / pip / npm).
- If a step needs an environment variable (an API key, token, endpoint), add it \
to env_suggestions with the variable key and the reason. NEVER produce a value. \
Mark secret_likely=true for credentials.
- If the document describes no external command-line dependency, return \
{"inferable": false, "cli_tools": [], "reason": "<one short sentence why>"}.

Respond with JSON only, matching exactly:
{"inferable": bool,
 "cli_tools": [{"name": str, "description": str, "command": str,
                "install_commands": [str], "env_suggestions":
                [{"key": str, "reason": str, "secret_likely": bool}]}],
 "reason": str | null}
"""


class SkillToolInferenceService:
    """Single-shot LLM inference over a drive-stored SKILL.md."""

    def __init__(self, *, drive_service: AgentDriveService | None = None) -> None:
        self._drive = drive_service or AgentDriveService()

    def infer(self, *, tenant_id: str, agent_id: str, slug: str, session: Session) -> dict[str, Any]:
        skill_md = self._load_skill_md(tenant_id=tenant_id, agent_id=agent_id, slug=slug, session=session)

        user_prompt = f"SKILL.md of skill '{slug}':\n\n{skill_md}"

        raw = self._invoke(tenant_id=tenant_id, user_prompt=user_prompt)
        try:
            result = self._parse(raw)
        except (ValidationError, ValueError):
            logger.warning("skill tool inference output unparsable, retrying once")
            raw = self._invoke(tenant_id=tenant_id, user_prompt=user_prompt)
            try:
                result = self._parse(raw)
            except (ValidationError, ValueError) as exc:
                raise SkillToolInferenceError(
                    "inference_failed",
                    "inference_failed: the model output could not be parsed into tool suggestions.",
                    status_code=422,
                ) from exc

        for tool in result.cli_tools:
            tool.inferred_from = slug
        return result.model_dump(mode="json")

    def _load_skill_md(self, *, tenant_id: str, agent_id: str, slug: str, session: Session) -> str:
        try:
            preview = self._drive.preview(
                tenant_id=tenant_id, agent_id=agent_id, key=f"{slug}/SKILL.md", session=session
            )
        except AgentDriveError as exc:
            if exc.code == "drive_key_not_found":
                raise SkillToolInferenceError(
                    "skill_not_found", f"skill_not_found: no drive entry for skill '{slug}'.", status_code=404
                ) from exc
            raise SkillToolInferenceError(exc.code, exc.message, status_code=exc.status_code) from exc
        if preview["binary"] or not preview["text"]:
            raise SkillToolInferenceError(
                "skill_not_found", f"skill_not_found: SKILL.md of '{slug}' is not readable text.", status_code=404
            )
        return str(preview["text"])

    @staticmethod
    def _invoke(*, tenant_id: str, user_prompt: str) -> str:
        try:
            model_manager = ModelManager.for_tenant(tenant_id=tenant_id)
            model_instance = model_manager.get_default_model_instance(tenant_id=tenant_id, model_type=ModelType.LLM)
        except ProviderTokenNotInitError as exc:
            raise SkillToolInferenceError(
                "default_model_not_configured",
                "default_model_not_configured: the workspace has no default reasoning model.",
                status_code=400,
            ) from exc
        try:
            response = model_instance.invoke_llm(
                prompt_messages=[
                    SystemPromptMessage(content=_SYSTEM_PROMPT),
                    UserPromptMessage(content=user_prompt),
                ],
                model_parameters={"temperature": 0.1},
                stream=False,
            )
        except Exception as exc:
            raise SkillToolInferenceError(
                "inference_failed", f"inference_failed: model invocation failed: {exc}", status_code=422
            ) from exc
        return response.message.get_text_content()

    @staticmethod
    def _parse(raw: str) -> SkillToolInferenceResult:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = json_repair.loads(raw)
        if not isinstance(parsed, dict):
            raise ValueError("model output is not a JSON object")
        return SkillToolInferenceResult.model_validate(parsed)


__all__ = [
    "CliToolSuggestion",
    "EnvSuggestion",
    "SkillToolInferenceError",
    "SkillToolInferenceResult",
    "SkillToolInferenceService",
]
