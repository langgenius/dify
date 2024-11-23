from enum import Enum


class RerankMode(str, Enum):
    RERANKING_MODEL = "reranking_model"
    WEIGHTED_SCORE = "weighted_score"
