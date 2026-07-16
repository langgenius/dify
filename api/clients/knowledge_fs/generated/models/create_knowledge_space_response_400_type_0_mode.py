from enum import Enum


class CreateKnowledgeSpaceResponse400Type0Mode(str, Enum):
    DEEP = "deep"
    FAST = "fast"
    RESEARCH = "research"

    def __str__(self) -> str:
        return str(self.value)
