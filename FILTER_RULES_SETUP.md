# Filter Rules Management Feature

## 概述

此功能允许通过前端界面管理 RAG 过滤规则（实体和属性），而无需直接编辑 CSV 文件。

## 功能特性

- ✅ 通过 Web 界面管理过滤规则
- ✅ 添加、编辑、删除基础实体（如 E8Q Pro, P20 Ultra 等）
- ✅ 添加、编辑、删除属性（如尺寸、颜色、版本等）
- ✅ 搜索和过滤功能
- ✅ 导出为 CSV 文件
- ✅ 实时预览和验证
- ✅ 自动备份机制（保留最近 10 个备份）
- ✅ 权限控制（仅 admin/owner 可修改）

## 文件结构

### 后端

```
api/
├── services/
│   └── filter_rule_service.py          # Service 层，处理业务逻辑
├── controllers/console/workspace/
│   └── filter_rules.py                  # API 控制器
└── core/rag/filter/
    └── config/
        ├── filter_rules.csv             # 规则数据文件
        └── backups/                     # 自动备份目录
```

### 前端

```
web/
├── service/
│   └── filter-rules.ts                  # API 服务层
├── app/components/workspace/filter-rules/
│   ├── index.tsx                        # 主容器组件
│   ├── entity-list.tsx                  # 实体列表组件
│   ├── edit-entity-modal.tsx            # 添加/编辑模态框
│   └── types.ts                         # TypeScript 类型定义
├── app/components/header/account-setting/
│   └── filter-rules-page/
│       └── index.tsx                    # 设置页面包装组件
└── i18n/
    ├── en-US/
    │   ├── filter-rules.ts              # 英文翻译
    │   └── common.ts                    # (已更新)
    └── zh-Hans/
        ├── filter-rules.ts              # 中文翻译
        └── common.ts                    # (已更新)
```

## API 端点

### 获取所有规则
```
GET /console/api/workspaces/current/filter-rules
```

### 批量更新规则
```
POST /console/api/workspaces/current/filter-rules
Body: {
  "entities": [{"name": "E8Q Pro", "attribute_type": ""}],
  "attributes": [{"name": "75寸", "attribute_type": "尺寸"}]
}
```

### 添加实体/属性
```
POST /console/api/workspaces/current/filter-rules/entity
Body: {
  "name": "E8Q Pro",
  "attribute_type": ""  // 空字符串表示基础实体
}
```

### 更新实体/属性
```
PATCH /console/api/workspaces/current/filter-rules/entity
Body: {
  "old_name": "E8Q",
  "new_name": "E8Q Pro",
  "attribute_type": ""
}
```

### 删除实体/属性
```
DELETE /console/api/workspaces/current/filter-rules/entity
Body: {
  "name": "E8Q Pro"
}
```

## 使用方法

### 访问管理界面

1. 登录 Dify 平台
2. 点击右上角头像 → **设置** (Settings)
3. 在左侧菜单中找到 **过滤规则** (Filter Rules)

### 管理基础实体

1. 在左侧"基础实体"面板中：
   - 点击 **添加实体** 按钮
   - 输入实体名称（如：E8Q Pro, P20 Ultra）
   - 点击保存

2. 编辑实体：
   - 点击实体行右侧的编辑图标
   - 修改名称
   - 保存更改

3. 删除实体：
   - 点击实体行右侧的删除图标
   - 确认删除

### 管理属性

1. 在右侧"属性"面板中：
   - 点击 **添加属性** 按钮
   - 输入属性名称（如：75寸）
   - 选择属性类型（尺寸、颜色、版本、款式、产品定位）
   - 点击保存

2. 支持的属性类型：
   - **尺寸**：如 75寸、85寸、100寸
   - **颜色**：如黑色、白色、黑金
   - **版本**：如增强版、标准版、履带版
   - **款式**：如超薄、壁纸电视、艺术款
   - **产品定位**：如旗舰、新品、高端

### 导出规则

- 点击右上角 **导出 CSV** 按钮
- 系统将下载包含所有规则的 CSV 文件
- 文件名格式：`filter_rules_YYYY-MM-DD.csv`

## 权限控制

- **查看规则**：所有登录用户
- **修改规则**：仅 workspace 的 Admin 或 Owner
- **权限检查**：在每个修改接口中强制执行

## 数据备份

- 每次更新规则时自动创建备份
- 备份文件保存在 `api/core/rag/filter/config/backups/` 目录
- 自动保留最近 10 个备份文件
- 备份文件名格式：`filter_rules_backup_YYYYMMDD_HHMMSS.csv`

## 技术实现

### 缓存管理

- 规则数据被 `FilterRuleLoader` 缓存
- 每次更新后自动调用 `FilterRuleLoader.clear_cache()` 清除缓存
- 确保规则立即生效

### 数据验证

- **实体名称**：不能为空，最大长度 100 字符
- **属性类型**：必须是预定义的类型之一
- **重复检查**：防止添加重复的实体/属性

### 错误处理

- 所有 API 返回标准的错误消息
- 前端显示友好的错误提示
- 记录详细的日志用于调试

## 开发指南

### 后端测试

```bash
cd api
# 运行单元测试
uv run --project api --dev pytest tests/unit_tests/services/test_filter_rule_service.py

# 运行类型检查
make type-check

# 运行 linter
make lint
```

### 前端测试

```bash
cd web
# 运行测试
pnpm test

# 运行 linter
pnpm lint

# 修复 linter 问题
pnpm lint:fix
```

### 添加新的属性类型

1. 在 `web/app/components/workspace/filter-rules/types.ts` 中的 `ATTRIBUTE_TYPES` 数组添加新类型：
```typescript
export const ATTRIBUTE_TYPES = [
  { value: '尺寸', label: '尺寸' },
  { value: '颜色', label: '颜色' },
  // 添加新类型
  { value: '新类型', label: '新类型' },
] as const
```

2. 在国际化文件中添加对应的翻译

## 故障排除

### 规则未生效

**问题**：更新规则后，过滤功能未使用新规则

**解决方案**：
1. 检查后端日志，确认缓存已清除
2. 重启后端服务
3. 检查 CSV 文件是否正确更新

### 权限被拒绝

**问题**：尝试修改规则时收到 403 错误

**解决方案**：
1. 确认你的账户是 workspace 的 Admin 或 Owner
2. 联系 workspace 所有者授予权限

### 前端无法加载规则

**问题**：前端显示"加载失败"

**解决方案**：
1. 检查后端 API 是否正常运行
2. 检查网络连接
3. 查看浏览器控制台的错误信息
4. 检查 CSV 文件是否存在且格式正确

## 未来改进

- [ ] 批量导入 CSV 功能
- [ ] 规则变更历史记录
- [ ] 拖拽排序（影响匹配优先级）
- [ ] 规则预览和测试工具
- [ ] 规则使用统计
- [ ] 审计日志

## 相关文档

- [AGENTS.md](./AGENTS.md) - 项目开发规范
- [api/core/rag/filter/filter_rule_loader.py](./api/core/rag/filter/filter_rule_loader.py) - 规则加载器
- [api/tests/unit_tests/core/rag/filter/test_filter_rule_loader.py](./api/tests/unit_tests/core/rag/filter/test_filter_rule_loader.py) - 测试用例

## 联系方式

如有问题或建议，请联系开发团队或提交 Issue。

