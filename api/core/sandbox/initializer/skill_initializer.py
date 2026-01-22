from __future__ import annotations

import logging

from core.sandbox.sandbox import Sandbox
from core.skill import SkillAttrs
from core.skill.skill_manager import SkillManager

from .base import SyncSandboxInitializer

logger = logging.getLogger(__name__)


class SkillInitializer(SyncSandboxInitializer):
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

    def initialize(self, env: Sandbox) -> None:
        artifact_set = SkillManager.load_artifact(
            self._tenant_id,
            self._app_id,
            self._assets_id,
        )
        env.attrs.set(
            SkillAttrs.ARTIFACT_SET,
            artifact_set,
        )
