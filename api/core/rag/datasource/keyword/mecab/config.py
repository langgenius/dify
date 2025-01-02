from pydantic import BaseModel


class MeCabConfig(BaseModel):
    """Configuration for MeCab keyword processor."""

    max_keywords_per_chunk: int = 10
    min_keyword_length: int = 2
    score_threshold: float = 0.3
    storage_type: str = "database"
    cache_timeout: int = 3600

    # MeCab specific settings
    dictionary_path: str = ""  # Optional custom dictionary path
    user_dictionary_path: str = ""  # Optional user dictionary path
    pos_weights: dict = {
        "名詞": 1.0,  # Nouns
        "動詞": 0.8,  # Verbs
        "形容詞": 0.6,  # Adjectives
        "副詞": 0.4,  # Adverbs
    }
