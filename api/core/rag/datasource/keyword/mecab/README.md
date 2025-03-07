# MeCab Keyword Processor for Dify

A Japanese text keyword extraction module for Dify's RAG system, powered by MeCab morphological analyzer.

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

# Initialize with KEYWORD_STORE = "mecab" in config
keyword_processor = Keyword(dataset)

# Process documents
documents = [
    Document(
        page_content="自然言語処理は人工知能の重要な分野です。",
        metadata={"doc_id": "1"}
    )
]
keyword_processor.create(documents)

# Search
results = keyword_processor.search("自然言語処理")
```

## Configuration

### Basic Settings

```python
# In your environment configuration:
KEYWORD_STORE = "mecab"
KEYWORD_DATA_SOURCE_TYPE = "database"  # or other supported storage types
```

### Advanced Settings

```python
# MeCab-specific configuration
MECAB_CONFIG = {
    "max_keywords_per_chunk": 10,
    "score_threshold": 0.3,
    "dictionary_path": "/path/to/dict",      # Optional
    "user_dictionary_path": "/path/to/user_dict",  # Optional
    "pos_weights": {
        "名詞": 1.0,  # Nouns
        "動詞": 0.8,  # Verbs
        "形容詞": 0.6  # Adjectives
    }
}
```

## Key Features

### 1. Intelligent Keyword Extraction

- Part-of-speech based scoring
- Compound word detection
- Technical term recognition
- Reading normalization for variations

### 2. Storage Options

- Database storage (default)
- File-based storage
- Concurrent access support via Redis locking

### 3. Error Handling

- Comprehensive exception handling
- Detailed logging
- Graceful fallbacks

## Dependencies

```bash
# Ubuntu/Debian
apt-get install mecab mecab-ipadic-utf8 python3-mecab

# macOS
brew install mecab mecab-ipadic
pip install mecab-python3
```

## Best Practices

1. **Performance**
   - Use batch processing for large datasets
   - Configure appropriate cache timeouts
   - Monitor memory usage

2. **Customization**
   - Update dictionaries regularly
   - Adjust POS weights for your use case
   - Set appropriate thresholds

3. **Error Handling**
   - Implement proper logging
   - Handle dictionary loading errors
   - Manage concurrent access

## Example Usage

### Basic Keyword Extraction

```python
# Extract keywords from text
text = "自然言語処理は人工知能の重要な分野です。"
keywords = keyword_processor.create([
    Document(page_content=text, metadata={"doc_id": "1"})
])
```

### Custom Dictionary

```python
# Use custom dictionary
config = MeCabConfig(
    dictionary_path="/path/to/dict",
    user_dictionary_path="/path/to/user.dic"
)
```

### Batch Processing

```python
# Process multiple documents
documents = [
    Document(page_content=text1, metadata={"doc_id": "1"}),
    Document(page_content=text2, metadata={"doc_id": "2"})
]
keyword_processor.create(documents)
```

## Integration with Dify

The MeCab processor integrates seamlessly with Dify's existing keyword system:

1. Implements the `BaseKeyword` interface
2. Works with the keyword factory system
3. Supports all standard operations:
   - Document indexing
   - Keyword extraction
   - Search functionality
   - Index management

## Common Issues

1. **Dictionary Loading**

   ```python
   try:
       keyword_processor.create(documents)
   except KeywordProcessorError as e:
       logger.error("Dictionary loading failed: %s", str(e))
   ```

2. **Memory Management**

   ```python
   # Process in batches
   batch_size = 100
   for i in range(0, len(documents), batch_size):
       batch = documents[i:i + batch_size]
       keyword_processor.create(batch)
   ```

3. **Concurrent Access**

   ```python
   # Handled automatically via Redis locks
   keyword_processor.create(documents)  # Safe for concurrent use
   ```

For more details, refer to the [Dify Documentation](https://docs.dify.ai).

## Text Processing Examples

### Compound Words

The MeCab processor intelligently handles compound words in Japanese text:

```python
text = "人工知能と機械学習の研究を行っています。"
keywords = keyword_processor.create([
    Document(page_content=text, metadata={"doc_id": "1"})
])

# Extracted keywords include:
# - "人工知能" (artificial intelligence - compound)
# - "機械学習" (machine learning - compound)
# - "研究" (research - single)
```

Complex technical terms are properly recognized:

```python
text = "自然言語処理における深層学習の応用"
# Extracts:
# - "自然言語処理" (natural language processing)
# - "深層学習" (deep learning)
# - "応用" (application)
```

### Stopwords Handling

Common particles and auxiliary words are automatically filtered:

```python
text = "私はデータベースの設計をしています。"
# Ignores:
# - "は" (particle)
# - "の" (particle)
# - "を" (particle)
# - "います" (auxiliary verb)
# Extracts:
# - "データベース" (database)
# - "設計" (design)
```

Mixed language text is also handled appropriately:

```python
text = "AIシステムのパフォーマンスを改善する。"
# Ignores:
# - "の" (particle)
# - "を" (particle)
# - "する" (auxiliary verb)
# Extracts:
# - "AI" (kept as is)
# - "システム" (system)
# - "パフォーマンス" (performance)
# - "改善" (improvement)
```

### Reading Variations

The processor normalizes different forms of the same word:

```python
text1 = "データベース設計"  # カタカナ
text2 = "データベース設計"  # with readings
# Both normalize to the same keywords:
# - "データベース"
# - "設計"
```

### Technical Term Boosting

Technical terms receive higher scores in keyword extraction:

```python
text = "機械学習モデルを用いた自然言語処理の研究"
# Prioritizes technical terms:
# High score:
# - "機械学習" (machine learning)
# - "自然言語処理" (natural language processing)
# Lower score:
# - "研究" (research)
# - "モデル" (model)
```
