[English](./README.md) | [简体中文](./README_CN.md) | [日本語](./README_JA.md) | [Español](./README_ES.md) | [Français](./README_FR.md)

#Dify.ai 本地开发工具

## 代码风格管理 - 提高代码质量

通过设置预提交钩子确保一致的代码质量。

一致的代码质量可自动执行代码标准，从而简化开发过程。这能最大限度地减少偏差，简化代码审查。这看似强势，实则有益，因为它能促进更高效、更有凝聚力的工作流程。

这是一种主动措施，可在开发周期的早期发现问题，节省时间并保持代码质量。

###设置预提交

要安装预提交钩子，请运行

```sh
# 注意：如果使用预提交钩子，请确保处于虚拟环境中

# 为 pre-commit 安装 pip 包和 git 挂钩
make install_local_dev

# 可选： 链接到仓库的预提交脚本（意味着项目可以有集中的预提交逻辑）
ln -s pre-commit .git/hooks/pre-commit
```

### 检查什么

我们的预提交配置会强制检查空格、EOF 固定器和各种文件格式的语法验证。它还会检查潜在的安全问题，如暴露的私钥。

### 钩子

我们使用 `pre-commit-hooks` 中的钩子进行一般检查，同时使用 `ruff-pre-commit` 进行 Python 特定的检查。

有关钩子的详细配置，请参阅 `.pre-commit-config.yaml`。

## 测试

使用我们的测试套件维护代码完整性：

### 集成测试

执行模型 API 集成测试：

```sh
pytest api/tests/integration_tests/
```

### 单元测试

评估工具功能：

```sh
pytest api/tests/unit_tests/
```
