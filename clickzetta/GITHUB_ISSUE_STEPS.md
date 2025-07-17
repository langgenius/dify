# GitHub Issue 创建步骤指南

## 第1步：访问Dify项目的Issues页面
访问：https://github.com/langgenius/dify/issues/new

## 第2步：选择Issue类型
选择 "Feature Request" 或 "Get started"

## 第3步：填写Issue内容
**标题**：
```
🚀 Feature Request: Add Clickzetta Lakehouse as Vector Database Option
```

**内容**：
复制并粘贴 `ISSUE_TEMPLATE.md` 文件中的全部内容

## 第4步：添加标签（如果可能）
建议添加以下标签：
- `enhancement`
- `vector-database`
- `feature-request`

## 第5步：提交Issue
点击 "Submit new issue" 按钮

## 第6步：获取Issue编号
提交后，您将看到一个新的Issue编号（例如：#12345）

## 第7步：更新PR描述
在PR #22551 的描述开头添加：
```
Closes #[刚创建的issue编号]
```

或者：
```
Related to #[刚创建的issue编号]
```

## 第8步：通知维护者
在PR中回复 @crazywoola：
```
@crazywoola I've created issue #[issue编号] to document this feature request as requested. The issue provides comprehensive context about customer demand and technical implementation details.
```

## 示例回复模板
```
@crazywoola Thank you for the feedback! I've created issue #[issue编号] to document this feature request as requested. 

The issue provides:
- Business justification and customer demand context
- Technical specifications and implementation details  
- Comprehensive testing evidence (100% pass rate)
- Performance benchmarks and validation results

The implementation is complete and ready for integration. Please let me know if you need any additional information or modifications.
```

## 预期结果
- Issue将为维护者提供完整的功能需求上下文
- PR将有明确的相关Issue链接
- 符合Dify项目的贡献流程和最佳实践
- 提高PR被接受的可能性