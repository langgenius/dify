"""Adapt Skill reads to the workflow publication port."""

from services.skill_management_service import SkillManagementService


class WorkflowAgentSkillReader:
    def __init__(self, skills: SkillManagementService) -> None:
        self._skills = skills

    def names(self, tenant_id: str, agent_id: str, snapshot_id: str) -> set[str]:
        return {
            str(item["name"])
            for item in self._skills.list_runtime_agent_skills(
                tenant_id=tenant_id, agent_id=agent_id, config_snapshot_id=snapshot_id
            )
        }
