from enum import Enum


class CreateKnowledgeSpaceResponse400Type0Code(str, Enum):
    RETRIEVAL_PROFILE_SCORE_THRESHOLD_REQUIRES_RERANK = (
        "RETRIEVAL_PROFILE_SCORE_THRESHOLD_REQUIRES_RERANK"
    )

    def __str__(self) -> str:
        return str(self.value)
