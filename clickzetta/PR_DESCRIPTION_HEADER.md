## Related Issue
Closes #22557

## Summary
This PR adds Clickzetta Lakehouse as a vector database option in Dify, enabling customers to use Clickzetta as their unified data platform for both vector and structured data storage.

## Key Features
- ✅ Full BaseVector interface implementation
- ✅ HNSW vector indexing with automatic management
- ✅ Concurrent write operations with queue mechanism
- ✅ Chinese text analysis and full-text search
- ✅ Comprehensive error handling and retry mechanisms

## Testing Status
- 🧪 **Standalone Tests**: 3/3 passed (100%)
- 🧪 **Integration Tests**: 8/8 passed (100%)
- 🧪 **Performance**: Vector search ~170ms, Insert rate ~5.3 docs/sec
- 🧪 **Real Environment**: Validated with actual Clickzetta Lakehouse instance

## Business Impact
Real commercial customers are actively waiting for this Dify + Clickzetta integration solution for trial validation. This integration eliminates the need for separate vector database infrastructure while maintaining enterprise-grade performance and reliability.

---

[保留原有的详细PR描述内容...]