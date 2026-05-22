# 扫描前端代码中所有 "Dify" 位置 的计划

## 目标
扫描前端代码（`web/` 目录），找出所有包含 "Dify" 字符串的文件，并按类别整理输出结构化报告。

## 范围
- **扫描目录**: `web/`
- **排除目录**: `node_modules`, `.next`, `dist`, `.venv`
- **全量文件数**: 约 **525** 个文件

## 执行步骤

### 步骤 1：按文件类型统计分布
- `.json` — ~429 个 (i18n 国际化翻译文件)
- `.tsx` — ~58 个 (React 组件)
- `.ts` — ~18 个 (TypeScript 工具/类型文件)
- `.mdx` / `.md` — ~16 个 (文档)
- `.js` — ~2 个
- `.html` / `.css` — ~2 个

### 步骤 2：按目录分类扫描

| 目录 | 说明 | 预估文件数 |
|------|------|-----------|
| `web/i18n/*/` | 国际化翻译文件 (约 23 个语言, 每语言 ~19 个文件) | ~437 |
| `web/app/components/` | React 组件 (Logo、Header、Workflow、Chat 等) | ~40 |
| `web/app/components/develop/template/` | 开发者模板 | ~12 |
| `web/__tests__/` | 测试文件 | ~12 |
| `web/hooks/` | React Hooks | ~2 |
| `web/service/` | API 服务层 | ~2 |
| `web/types/` | TypeScript 类型定义 | ~1 |
| `web/scripts/` | 构建脚本 | ~3 |
| `web/public/` | 静态资源 | ~2 |
| `web/docs/` | 文档 | ~2 |
| 其他 | 样式、配置等 | ~10 |

### 步骤 3：按匹配模式分类并输出
对每一类进行详细扫描，包括每行匹配的**文件路径**、**行号**、**匹配内容**：

1. **i18n 国际化中的品牌名** — `web/i18n/*.json` 中 "Dify" 出现的具体 key 和值
2. **React 组件中的 UI 品牌展示** — Logo 组件、Header、Footer 等中的 "Dify"
3. **代码逻辑中的引用** — 常量、变量名、注释中的 "Dify"
4. **测试文件中的引用** — 测试断言、mock 中的 "Dify"
5. **配置/脚本中的项目名** — package.json、webpack、脚本中的 "Dify"
6. **文档中的品牌名** — MDX/MD 文档中的 "Dify"

### 步骤 4：生成报告
最终输出一份结构化的前端扫描报告，包含：

```
========================================
前端代码 "Dify" 扫描报告
========================================

一、总览
  - 前端文件总数:  525
  - i18n 文件数:   ~437
  - 非 i18n 文件数: ~88

二、按文件类型分布
  - .json   429 个
  - .tsx     58 个
  - .ts      18 个
  - .mdx     12 个
  - .md       4 个
  - .js       2 个
  - .html     1 个
  - .css      1 个

三、按目录分布
  (列出每个目录中的文件数)

四、详细文件列表

  【A. i18n 国际化文件 (web/i18n/)】
  (按语言列出每个文件中 "Dify" 出现的具体 key 和翻译值)
  
  【B. React 组件 (web/app/components/)】
  (文件路径 | 行号 | 匹配内容 | 所属组件)
  
  【C. 测试文件 (web/__tests__/)】
  (文件路径 | 行号 | 匹配内容)
  
  【D. Hooks / Service / Types】
  (文件路径 | 行号 | 匹配内容)
  
  【E. 配置 / 脚本 (web/scripts/, 配置文件等)】
  (文件路径 | 行号 | 匹配内容)

  【F. 文档 (web/docs/)】
  (文件路径 | 行号 | 匹配内容)
```

## 输出方式
将报告写入文件 `/home/project/dify/.trae/documents/dify-frontend-locations-report.md`

## 后续可选的深入分析
- i18n 翻译一致性：检查各语言中 "Dify" 的翻译是否统一
- 品牌展示位置汇总：Logo、Header、Footer、登录页等
- 组件中硬编码品牌名：是否有本应走 i18n 却硬编码的 "Dify"