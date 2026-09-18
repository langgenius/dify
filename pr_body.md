## Summary

MCP servers that omit the optional `title` field (e.g. Exa at `https://mcp.exa.ai/mcp`) caused Dify to serialize `title` as JSON `null`. This broke `I18nObject` validation during provider registration, leaving a broken row in `tool_mcp_providers`.

## Changes

- Add `_normalize_mcp_tool_data()` in `MCPToolManageService` to handle absent optional fields:
  - `title` falls back to `annotations.title`, then `name`
  - `description` defaults to empty string
  - `outputSchema` defaults to empty dict
  - `meta` is removed when `None`
- Apply normalization in `list_provider_tools()` and the reconnect path
- `mcp_tool_to_user_tool()` now uses `tool.title` for the label when available
- Add unit tests covering the normalization behavior

## Related Issue

Fixes #42453

## Verification

```
已运行并通过：
- python test_normalize.py (5 assertions, all passed)
  - title falls back to name when absent
  - title preserved when provided
  - title falls back to annotations.title
  - no title:null in serialized JSON
  - description defaults to empty string

尚未执行及原因：
- make lint / make type-check — uv sync 因 chroma-hnswlib 需要 MSVC 编译工具链而失败
- make test (全量) — 同上，项目依赖未完整安装
- api/tests/unit_tests/tools/test_mcp_tool.py — conftest.py 依赖 graphon 模块，环境未就绪

CI 应能完整验证 lint、type-check 和全量测试。
```
