"""Dependency composition for workspace Skill management."""

from sqlalchemy.orm import Session

from core.db.session_factory import get_session_maker
from repositories.tag_repository import TagRepository
from services.skill_management_service import SkillManagementService


def build_skill_management_service(*, session: Session) -> SkillManagementService:
    return SkillManagementService(
        session=session,
        skill_tags=TagRepository(get_session_maker()),
    )
