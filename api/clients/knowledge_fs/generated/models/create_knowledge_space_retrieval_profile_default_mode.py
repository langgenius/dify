from enum import Enum


class CreateKnowledgeSpaceRetrievalProfileDefaultMode(str, Enum):
    DEEP = "deep"
    FAST = "fast"
    RESEARCH = "research"

    def __str__(self) -> str:
        return str(self.value)
