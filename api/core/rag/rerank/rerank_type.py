from enum import StrEnum


class RerankMode(StrEnum):
    RERANKING_MODEL = "reranking_model"
    WEIGHTED_SCORE = "weighted_score"
