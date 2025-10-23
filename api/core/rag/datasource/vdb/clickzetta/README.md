# Clickzetta Vector Database Integration

This module provides integration with Clickzetta Lakehouse as a vector database for Dify.

## Features

- **Vector Storage**: Store and retrieve high-dimensional vectors using Clickzetta's native VECTOR type
- **Vector Search**: Efficient similarity search using HNSW algorithm
- **Full-Text Search**: Leverage Clickzetta's inverted index for powerful text search capabilities
- **Hybrid Search**: Combine vector similarity and full-text search for better results
- **Multi-language Support**: Built-in support for Chinese, English, and Unicode text processing
- **Scalable**: Leverage Clickzetta's distributed architecture for large-scale deployments

## Configuration

### Required Environment Variables

All seven configuration parameters are required:

```bash
# Authentication
CLICKZETTA_USERNAME=your_username
CLICKZETTA_PASSWORD=your_password

# Instance configuration
CLICKZETTA_INSTANCE=your_instance_id
CLICKZETTA_SERVICE=api.clickzetta.com
CLICKZETTA_WORKSPACE=your_workspace
CLICKZETTA_VCLUSTER=your_vcluster
CLICKZETTA_SCHEMA=your_schema
```

### Optional Configuration

```bash
# Batch processing
CLICKZETTA_BATCH_SIZE=100

# Full-text search configuration
CLICKZETTA_ENABLE_INVERTED_INDEX=true
CLICKZETTA_ANALYZER_TYPE=chinese  # Options: keyword, english, chinese, unicode
CLICKZETTA_ANALYZER_MODE=smart    # Options: max_word, smart

# Vector search configuration
CLICKZETTA_VECTOR_DISTANCE_FUNCTION=cosine_distance  # Options: l2_distance, cosine_distance
```

## Usage

### 1. Set Clickzetta as the Vector Store

In your Dify configuration, set:

```bash
VECTOR_STORE=clickzetta
```

### 2. Table Structure

Clickzetta will automatically create tables with the following structure:

```sql
CREATE TABLE <collection_name> (
    id STRING NOT NULL,
    content STRING NOT NULL,
    metadata JSON,
    vector VECTOR(FLOAT, <dimension>) NOT NULL,
    PRIMARY KEY (id)
);

-- Vector index for similarity search
CREATE VECTOR INDEX idx_<collection_name>_vec
ON TABLE <schema>.<collection_name>(vector) 
PROPERTIES (
    "distance.function" = "cosine_distance",
    "scalar.type" = "f32"
);

-- Inverted index for full-text search (if enabled)
CREATE INVERTED INDEX idx_<collection_name>_text
ON <schema>.<collection_name>(content)
PROPERTIES (
    "analyzer" = "chinese",
    "mode" = "smart"
);
```

## Full-Text Search Capabilities

Clickzetta supports advanced full-text search with multiple analyzers:

### Analyzer Types

1. **keyword**: No tokenization, treats the entire string as a single token

   - Best for: Exact matching, IDs, codes

1. **english**: Designed for English text

   - Features: Recognizes ASCII letters and numbers, converts to lowercase
   - Best for: English content

1. **chinese**: Chinese text tokenizer

   - Features: Recognizes Chinese and English characters, removes punctuation
   - Best for: Chinese or mixed Chinese-English content

1. **unicode**: Multi-language tokenizer based on Unicode

   - Features: Recognizes text boundaries in multiple languages
   - Best for: Multi-language content

### Analyzer Modes

- **max_word**: Fine-grained tokenization (more tokens)
- **smart**: Intelligent tokenization (balanced)

### Full-Text Search Functions

- `MATCH_ALL(column, query)`: All terms must be present
- `MATCH_ANY(column, query)`: At least one term must be present
- `MATCH_PHRASE(column, query)`: Exact phrase matching
- `MATCH_PHRASE_PREFIX(column, query)`: Phrase prefix matching
- `MATCH_REGEXP(column, pattern)`: Regular expression matching

## Performance Optimization

### Vector Search

1. **Adjust exploration factor** for accuracy vs speed trade-off:

   ```sql
   SET cz.vector.index.search.ef=64;
   ```

1. **Use appropriate distance functions**:

   - `cosine_distance`: Best for normalized embeddings (e.g., from language models)
   - `l2_distance`: Best for raw feature vectors

### Full-Text Search

1. **Choose the right analyzer**:

   - Use `keyword` for exact matching
   - Use language-specific analyzers for better tokenization

1. **Combine with vector search**:

   - Pre-filter with full-text search for better performance
   - Use hybrid search for improved relevance

## Troubleshooting

### Connection Issues

1. Verify all 7 required configuration parameters are set
1. Check network connectivity to Clickzetta service
1. Ensure the user has proper permissions on the schema

### Search Performance

1. Verify vector index exists:

   ```sql
   SHOW INDEX FROM <schema>.<table_name>;
   ```

1. Check if vector index is being used:

   ```sql
   EXPLAIN SELECT ... WHERE l2_distance(...) < threshold;
   ```

   Look for `vector_index_search_type` in the execution plan.

### Full-Text Search Not Working

1. Verify inverted index is created
1. Check analyzer configuration matches your content language
1. Use `TOKENIZE()` function to test tokenization:
   ```sql
   SELECT TOKENIZE('your text', map('analyzer', 'chinese', 'mode', 'smart'));
   ```

## Limitations

1. Vector operations don't support `ORDER BY` or `GROUP BY` directly on vector columns
1. Full-text search relevance scores are not provided by Clickzetta
1. Inverted index creation may fail for very large existing tables (continue without error)
1. Index naming constraints:
   - Index names must be unique within a schema
   - Only one vector index can be created per column
   - The implementation uses timestamps to ensure unique index names
1. A column can only have one vector index at a time

## References

- [Clickzetta Vector Search Documentation](https://yunqi.tech/documents/vector-search)
- [Clickzetta Inverted Index Documentation](https://yunqi.tech/documents/inverted-index)
- [Clickzetta SQL Functions](https://yunqi.tech/documents/sql-reference)
