from enum import Enum


class CreateKnowledgeSpaceRetrievalProfileScoreThresholdStage(str, Enum):
    MODE_FINAL = "mode-final"
    RERANK = "rerank"

    def __str__(self) -> str:
        return str(self.value)
