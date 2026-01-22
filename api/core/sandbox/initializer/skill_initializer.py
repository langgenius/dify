from __future__ import annotations

import logging

from core.sandbox.sandbox import Sandbox
from core.skill import SkillAttrs
from core.skill.skill_manager import SkillManager

from .base import SandboxInitializer

logger = logging.getLogger(__name__)


class SkillInitializer(SandboxInitializer):
    def __init__(
        self,
        tenant_id: str,
        user_id: str,
        app_id: str,
        assets_id: str,
    ) -> None:
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._user_id = user_id
        self._assets_id = assets_id

    def initialize(self, sandbox: Sandbox) -> None:
        artifact_set = SkillManager.load_artifact(
            self._tenant_id,
            self._app_id,
            self._assets_id,
        )
        if artifact_set is None:
            raise ValueError(
                f"No skill artifact set found for tenant_id={self._tenant_id},"
                f"app_id={self._app_id}, "
                f"assets_id={self._assets_id} "
            )

        sandbox.attrs.set(
            SkillAttrs.ARTIFACT_SET,
            artifact_set,
        )
