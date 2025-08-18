# Output Registry

Thread-safe storage for node outputs.

## Features

### Thread-Safe Storage

Prevents race conditions in parallel execution.

### Dual Output Types

- **Scalar Values** - Complete values (results, data)
- **Streaming Data** - Sequential chunks (LLM responses)

### Stream Management

- Track read positions for multiple consumers
- Maintain closure state
- Support progressive processing

## Key Concepts

**Selector-Based Access**: Hierarchical paths identify data locations.

**Memory Efficiency**: Read positions instead of data duplication.

## Usage Pattern

1. Producer nodes write outputs using selectors
2. Consumer nodes read inputs via selectors
3. Coordinator monitors stream states
4. Engine manages cleanup
