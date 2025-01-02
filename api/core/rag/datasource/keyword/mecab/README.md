# MeCab Keyword Processor

A Japanese text keyword extraction module using MeCab morphological analyzer for the Dify RAG system.

## Overview

This module provides Japanese text keyword extraction capabilities using the MeCab morphological analyzer. It's designed to:

- Extract meaningful keywords from Japanese text
- Handle compound words and technical terms
- Support custom dictionaries
- Provide configurable scoring based on parts of speech
- Handle mixed Japanese-English text

## Components

### 1. MeCabKeywordTableHandler

The core component responsible for keyword extraction using MeCab:

```python
handler = MeCabKeywordTableHandler(
    dictionary_path="/path/to/dict",    # Optional custom dictionary
    user_dictionary_path="/path/to/user_dict"  # Optional user dictionary
)
keywords = handler.extract_keywords(text, max_keywords=10)
```

#### Features:

- **Part of Speech (POS) Weighting**:

  ```python
  pos_weights = {
      '名詞': 1.0,      # Nouns
      '動詞': 0.8,      # Verbs
      '形容詞': 0.6,    # Adjectives
      '副詞': 0.4,      # Adverbs
      '連体詞': 0.3,    # Adnominal adjectives
      '感動詞': 0.2,    # Interjections
  }
  ```

- **Special Term Handling**:
  - Boosts scores for proper nouns (固有名詞)
  - Boosts scores for technical terms (専門用語)
  - Compound word detection (e.g., "機械学習", "自然言語処理")

- **Reading Normalization**:
  - Handles different forms of the same word
  - Normalizes compound terms using readings

### 2. Configuration (MeCabConfig)

Configurable settings for the processor:

```python
class MeCabConfig(BaseModel):
    max_keywords_per_chunk: int = 10
    min_keyword_length: int = 2
    score_threshold: float = 0.3
    storage_type: str = "database"
    cache_timeout: int = 3600
    dictionary_path: str = ""
    user_dictionary_path: str = ""
    pos_weights: dict = {...}
```

### 3. Stopwords

Comprehensive Japanese stopword list including:

- Particles (は, が, の, etc.)
- Auxiliary verbs (です, ます, etc.)
- Pronouns (これ, それ, etc.)
- Common words
- Numbers and punctuation
- Common English stopwords for mixed text

## Usage

### Basic Usage

```python
from core.rag.datasource.keyword.keyword_factory import Keyword
from models.dataset import Dataset

# Initialize
dataset = Dataset(...)
keyword_processor = Keyword(dataset)  # Will use MeCab if KEYWORD_STORE = "mecab"

# Process text
documents = [
    Document(
        page_content="自然言語処理は人工知能の重要な分野です。",
        metadata={"doc_id": "1", ...}
    )
]
keyword_processor.create(documents)

# Search
results = keyword_processor.search("自然言語処理について")
```

### Custom Dictionary Usage

```python
# In your configuration:
KEYWORD_PROCESSOR_CONFIG = {
    "dictionary_path": "/path/to/mecab/dict",
    "user_dictionary_path": "/path/to/user.dic",
    "pos_weights": {
        "名詞": 1.2,
        "動詞": 0.8,
        # ... customize weights
    }
}
```

## Features

### 1. Keyword Extraction

- **POS-based Scoring**:
  - Weights different parts of speech
  - Boosts important terms
  - Configurable scoring thresholds

- **Compound Word Detection**:

  ```python
  # Input text: "自然言語処理の研究"
  # Detected compounds:
  # - "自然言語"
  # - "自然言語処理"
  # - "言語処理"
  ```

- **Reading Normalization**:

  ```python
  # Handles variations:
  # - "データベース" (katakana)
  # - "データベース" (with readings)
  # Both normalize to same term
  ```

### 2. Storage

- **Flexible Storage Options**:
  - Database storage
  - File-based storage
  - Redis-based locking for concurrency

- **Data Structure**:

  ```python
  {
      "__type__": "keyword_table",
      "__data__": {
          "index_id": "dataset_id",
          "table": {
              "keyword1": ["doc_id1", "doc_id2"],
              "keyword2": ["doc_id2", "doc_id3"],
          }
      }
  }
  ```

### 3. Error Handling

- Comprehensive error handling
- Custom exception classes
- Logging integration
- Graceful fallbacks

## Performance Considerations

1. **Memory Usage**:
   - Efficient keyword table structure
   - Batch processing support
   - Caching mechanisms

2. **Concurrency**:
   - Redis-based locking
   - Transaction handling
   - Safe concurrent access

3. **Optimization Tips**:
   - Use appropriate batch sizes
   - Configure caching timeouts
   - Adjust scoring thresholds

## Dependencies

- MeCab and Python bindings:

  ```bash
  # Ubuntu/Debian
  apt-get install mecab mecab-ipadic-utf8 python3-mecab

  # macOS
  brew install mecab mecab-ipadic
  pip install mecab-python3
  ```

## Best Practices

1. **Dictionary Management**:
   - Keep dictionaries updated
   - Use domain-specific user dictionaries
   - Regular maintenance of custom terms

2. **Configuration Tuning**:
   - Adjust POS weights for your use case
   - Set appropriate thresholds
   - Monitor and adjust batch sizes

3. **Error Handling**:
   - Implement proper logging
   - Monitor extraction quality
   - Handle edge cases

## Testing

Example test cases:

```python
def test_basic_extraction():
    text = "自然言語処理は人工知能の重要な分野です。"
    keywords = handler.extract_keywords(text)
    assert "自然言語処理" in keywords
    assert "人工知能" in keywords

def test_compound_words():
    text = "機械学習モデルを使った自然言語処理"
    keywords = handler.extract_keywords(text)
    assert "機械学習" in keywords
    assert "自然言語処理" in keywords

def test_mixed_text():
    text = "AIを使った自然言語処理のResearch"
    keywords = handler.extract_keywords(text)
    assert "AI" in keywords
    assert "自然言語処理" in keywords
    assert "Research" in keywords
```

## Common Issues and Solutions

1. **Dictionary Loading Failures**:

   ```python
   try:
       handler = MeCabKeywordTableHandler(dictionary_path=path)
   except RuntimeError as e:
       # Handle dictionary loading error
   ```

2. **Memory Usage**:

   ```python
   # Use batch processing for large datasets
   for batch in chunks(documents, size=100):
       process_batch(batch)
   ```

3. **Concurrent Access**:

   ```python
   with redis_client.lock(f"lock_{dataset_id}"):
       # Safe concurrent operations
   ```
