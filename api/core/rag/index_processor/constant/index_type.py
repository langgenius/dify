from enum import StrEnum


class IndexStructureType(StrEnum):
    PARAGRAPH_INDEX = "text_model"
    QA_INDEX = "qa_model"
    PARENT_CHILD_INDEX = "hierarchical_model"


class IndexTechniqueType(StrEnum):
    ECONOMY = "economy"
    HIGH_QUALITY = "high_quality"
