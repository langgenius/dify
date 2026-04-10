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
        if sandbox.attrs.has(SkillAttrs.BUNDLE):
            return

        try:
            bundle = SkillManager.load_bundle(
                ctx.tenant_id,
                ctx.app_id,
                ctx.assets_id,
            )
            sandbox.attrs.set(SkillAttrs.BUNDLE, bundle)
        except FileNotFoundError:
            logger.debug("No skill bundle found for app %s, skipping skill initialization", ctx.app_id)
        except Exception:
            logger.warning("Failed to load skill bundle for app %s, skipping", ctx.app_id, exc_info=True)
