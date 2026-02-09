# Release Notes: i18n-errors-zh-v1

## 概述
将后端所有运行时用户可见的错误消息从英文翻译为中文，并建立统一的 error code 机制。

**分支**: `feat/i18n-error-zh`  
**标签**: `i18n-errors-zh-v1`  
**变更范围**: 401 files changed, 3280 insertions(+), 1900 deletions(-)
**提交数**: 5

---

## ⚠️ 对外行为变化（Breaking Changes）

### 1. OAuth 重定向参数变更
- **Before**: `/signin?message=Account not found`
- **After**: `/signin?code=account_not_found`
- **影响**: 前端 `normal-form.tsx` 已适配，通过 `code` 参数查找 i18n 翻译并展示
- **兼容**: 同时保留 `message` 参数读取作为 fallback

### 2. API Error 响应中 `code` 字段优先级
- **Before**: 400 错误统一返回 `{"code": "bad_request", "message": "..."}`，自定义 code 可能被覆盖
- **After**: `external_api.py` 中新增 `abort_with_code()` helper 和 `has_custom_code` 守卫  
  - `abort_with_code(status, message, error_code)` 在异常上设置 `e.error_code` 属性
  - handler 读取 `getattr(e, 'error_code', None)` 合并到 `code` 字段
  - Flask-RESTX 在 `e.data` 存在时会绕过自定义 handler，故避免使用 `e.data`
- **影响**: 带有自定义 `code` 的 abort 调用（如 `billing_upgrade_required`）现在正确返回业务 code
- **兼容**: 未设置自定义 code 的仍返回默认 `bad_request`

### 3. 错误消息语言变更
- **Before**: 所有 `abort()` / `raise` / `return {"message": ...}` 返回英文
- **After**: 控制器层所有用户可见错误返回中文
- **影响**: 前端 Toast/Modal/错误提示将展示中文
- **兼容**: Swagger 文档 (`@doc`, `@response`, `description=`) 保持英文不变

### 4. Webhook 返回结构
- 错误响应字段保持不变：`{"code": "...", "error": "...", "message": "..."}`
- 仅 `error` 和 `message` 值从英文改为中文
- 第三方调用方如果只依赖 `code` 字段判断错误类型，无影响

---

## 变更分类

### 机制层（Commit 1: 7 files + Commit 3-5: bug fixes）
| 文件 | 变更 |
|------|------|
| `api/libs/external_api.py` | 新增 `abort_with_code()` helper；handler 通过 `e.error_code` 属性读取自定义 code |
| `api/controllers/console/wraps.py` | 9 个 billing/quota abort 改用 `abort_with_code()`；3 个 annotation 限流消息翻译 |
| `api/controllers/console/auth/oauth.py` | 重定向 `?message=` → `?code=snake_case`；AccountRegisterError 翻译 |
| `api/controllers/console/auth/oauth_server.py` | 认证错误返回中文 |
| `api/controllers/console/auth/data_source_oauth.py` | 数据源 OAuth 错误返回中文 |
| `web/app/signin/normal-form.tsx` | 读取 `code` 参数 + i18n 翻译 |
| `web/i18n/en-US/common.json` | 17 个 error i18n key |
| `web/i18n/zh-Hans/common.json` | 17 个 error i18n key |

### 文案层（Commit 2: 387 files）
| 区域 | 文件数 | 说明 |
|------|--------|------|
| `controllers/console/` | ~80 | abort/raise/return 全量翻译 |
| `controllers/service_api/` | ~80 | API 错误消息翻译 |
| `controllers/web/` | ~15 | Web 应用错误翻译 |
| `controllers/trigger/` | ~5 | Webhook/Trigger 错误翻译 |
| `services/` | ~100 | 服务层错误翻译 |
| `core/` | ~80 | 核心引擎错误翻译 |
| `libs/extensions/tasks/` | ~27 | 基础设施层翻译 |

---

## 未翻译（有意保留英文）

| 类别 | 数量 | 原因 |
|------|------|------|
| Swagger `@doc(description=...)` | 331 处 | API 文档面向开发者，英文更通用 |
| `@response()` 描述 | ~100 处 | 同上 |
| `BaseHTTPException.description` | ~30 处 | 被 Swagger 引用 |
| `core/services` f-string 异常 | 648 处 | 内部技术异常，含动态变量名，留待 Phase 3 |

---

## 验证结论

| 检查项 | 结果 |
|--------|------|
| 编译检查 (1502 py files) | ✅ 0 errors |
| Controllers 英文 abort 残留 | ✅ 0 |
| Controllers 英文 raise 残留 | ✅ 0 |
| Controllers 英文 return msg 残留 | ✅ 0 |
| Swagger doc 污染 | ✅ 0 (331 处正确保持英文) |
| BaseHTTPException.description 误翻译 | ✅ 已回滚 2 处 |
| abort_with_code 端到端测试 | ✅ 403/400 响应均含 code+message+status |
| 回归测试 (libs/) | ✅ 401 passed, 0 failed |
| Docker build + smoke | ✅ 语法/内容/UTF-8 验证通过 |
| Webhook 影响 | ✅ 无影响（控制台 API 层不进入 webhook payload） |

---

## 已知债务（Phase 3）

| 类别 | 数量 | 说明 |
|------|------|------|
| `core/services` f-string 异常 | ~648 处 | 内部技术异常含动态变量，需逐一审查 |
| `BaseHTTPException` 架构 | ~55 个类 | `description` 同时用于 Swagger + message，无法区分语言 |
| Service API 层 (开发者API) | ~21 个错误类 | 面向开发者，需确认是否应保持英文 |

---

## 回滚方案
```bash
git revert HEAD~5..HEAD   # 回滚五个提交
# 或
git checkout main         # 切回 main 分支
```
