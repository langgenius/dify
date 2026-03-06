from collections.abc import Mapping

from core.app.entities.app_asset_entities import AppAssetFileTree
from core.skill.assembler.common import (
    build_skill_graph,
    compute_transitive_dependance,
    expand_referenced_skill_ids,
    get_metadata,
    process_skill_content,
)
from core.skill.entities.skill_bundle import Skill, SkillBundle, SkillDependance
from core.skill.entities.skill_document import SkillDocument


class SkillBundleAssembler:
    _file_tree: AppAssetFileTree

    def __init__(self, file_tree: AppAssetFileTree) -> None:
        self._file_tree = file_tree

    def assemble_bundle(
        self,
        documents: Mapping[str, SkillDocument],
        assets_id: str,
    ) -> SkillBundle:
        direct_skills: dict[str, Skill] = {}
        for skill_id, doc in documents.items():
            metadata = get_metadata(doc.content, doc.metadata)
            direct_dependance = SkillDependance.from_metadata(metadata)
            direct_skills[skill_id] = Skill(
                skill_id=skill_id,
                direct_dependance=direct_dependance,
                dependance=direct_dependance,
                content=process_skill_content(doc.content, metadata, self._file_tree, skill_id),
            )

        graph = build_skill_graph(direct_skills, self._file_tree)
        transitive_map = compute_transitive_dependance(direct_skills, graph)

        compiled_skills: dict[str, Skill] = {}
        for skill_id, skill in direct_skills.items():
            compiled_skills[skill_id] = skill.model_copy(update={"dependance": transitive_map[skill_id]})

        return SkillBundle(asset_tree=self._file_tree, assets_id=assets_id, skills=compiled_skills)


class SkillDocumentAssembler:
    _bundle: SkillBundle

    def __init__(self, bundle: SkillBundle) -> None:
        self._bundle = bundle

    def assemble_document(self, document: SkillDocument, base_path: str = "") -> Skill:
        metadata = get_metadata(document.content, document.metadata)
        direct_dependance = SkillDependance.from_metadata(metadata)
        resolved_content = process_skill_content(
            document.content,
            metadata,
            self._bundle.asset_tree,
            document.skill_id,
            base_path,
        )

        transitive_dependance = direct_dependance
        known_skill_ids = set(self._bundle.skills.keys())
        referenced_skill_ids = expand_referenced_skill_ids(
            direct_dependance.files, known_skill_ids, self._bundle.asset_tree
        )
        for skill_id in sorted(referenced_skill_ids):
            referenced_skill = self._bundle.get(skill_id)
            if referenced_skill is None:
                continue
            transitive_dependance = transitive_dependance | referenced_skill.dependance

        return Skill(
            skill_id=document.skill_id,
            direct_dependance=direct_dependance,
            dependance=transitive_dependance,
            content=resolved_content,
        )
