from __future__ import annotations

import logging

from core.sandbox.sandbox import Sandbox
from core.skill import SkillAttrs
from core.skill.skill_manager import SkillManager

from .base import SandboxInitializeContext, SyncSandboxInitializer

logger = logging.getLogger(__name__)


class SkillInitializer(SyncSandboxInitializer):
    """Ensure ``sandbox.attrs[BUNDLE]`` is populated for downstream consumers.

    In the draft path ``DraftAppAssetsInitializer`` already sets the
    bundle on attrs from the in-memory build result, so this initializer
    becomes a no-op.  In the published path no prior initializer sets
    it, so we fall back to ``SkillManager.load_bundle()`` (Redis/S3).
    """

    def initialize(self, sandbox: Sandbox, ctx: SandboxInitializeContext) -> None:
        # Draft path: bundle already populated by DraftAppAssetsInitializer.
        if sandbox.attrs.has(SkillAttrs.BUNDLE):
            return

        # Published path: load from Redis/S3.
        bundle = SkillManager.load_bundle(
            ctx.tenant_id,
            ctx.app_id,
            ctx.assets_id,
        )
        sandbox.attrs.set(SkillAttrs.BUNDLE, bundle)
