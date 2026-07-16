from enum import Enum


class CreateKnowledgeSpaceResponse400Type0Error(str, Enum):
    FASTDEEP_MODE_FINAL_SCORE_THRESHOLD_REQUIRES_THE_KNOWLEDGE_SPACE_RERANKER_TO_BE_ENABLED = "Fast/Deep mode-final score threshold requires the knowledge-space reranker to be enabled"

    def __str__(self) -> str:
        return str(self.value)
