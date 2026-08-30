# Dify 同步与定制开发指南

本项目是从官方 Dify 仓库 Fork 而来，用于本地定制开发。

## 🏗️ 仓库结构

```
远程仓库:
- origin   : https://github.com/wesharn/ai-agent-sys.git (你的 Fork)
- upstream : https://github.com/langgenius/dify.git (官方仓库)

本地分支:
- main    : 镜像官方最新版本，不做任何修改
- develop : 集成所有定制功能的开发分支
```

## 🔄 同步官方更新

### 方法1：使用同步脚本（推荐）

```bash
./sync-upstream.sh
```

### 方法2：手动同步

```bash
# 1. 切换到main分支
git checkout main

# 2. 拉取官方更新
git fetch upstream

# 3. 查看更新内容
git log HEAD..upstream/main --oneline

# 4. 合并官方更新
git merge upstream/main

# 5. 推送到你的远程仓库
git push origin main

# 6. 合并到develop分支
git checkout develop
git merge main

# 7. 如有冲突，解决后提交
git push origin develop
```

## 🛠️ 定制开发工作流

### 1. 创建功能分支

```bash
# 从develop创建新功能分支
git checkout develop
git checkout -b feature/custom-node

# 开发你的功能...
# 编辑文件，添加代码

# 提交更改
git add .
git commit -m "feat: 添加自定义节点"

# 推送到远程
git push origin feature/custom-node
```

### 2. 合并功能到develop

```bash
git checkout develop
git merge feature/custom-node
git push origin develop
```

### 3. 定制代码隔离建议

为了便于后续同步，建议将定制代码放在独立目录：

```
api/
└── extensions/          # 自定义扩展目录
    ├── custom_nodes/    # 自定义节点
    ├── custom_tools/    # 自定义工具
    └── custom_models/   # 自定义模型

web/
└── extensions/          # 前端扩展
    └── custom_components/
```

## ⚔️ 冲突解决

如果同步时出现冲突：

```bash
# 1. 查看冲突文件
git status

# 2. 编辑冲突文件，手动解决冲突
# 文件中会有类似这样的标记：
# <<<<<<< HEAD
# 你的代码
# =======
# 官方的代码
# >>>>>>> upstream/main

# 3. 标记为已解决
git add <冲突文件>

# 4. 完成合并
git commit -m "chore: resolve merge conflicts with upstream"
```

## 📅 建议的同步频率

- **定期同步**: 每 1-2 周同步一次官方更新
- **重大版本**: 官方发布重大版本时及时同步
- **安全更新**: 发现安全补丁时立即同步

## 🔍 查看官方更新

```bash
# 查看官方最新的更新
git fetch upstream
git log HEAD..upstream/main --oneline --graph

# 查看具体文件的变化
git diff HEAD..upstream/main -- path/to/file
```

## 📦 Docker 部署

同步更新后，记得重新构建 Docker 镜像：

```bash
cd docker
docker compose down
docker compose pull
docker compose up -d --build
```

## ⚠️ 注意事项

1. **永远不要直接在 main 分支上开发** - 保持它与官方同步
2. **定期备份数据库** - 升级前务必备份
3. **测试再部署** - 同步后在测试环境充分验证
4. **记录定制内容** - 维护 CHANGELOG-CUSTOM.md 记录你的修改

## 🆘 常见问题

### Q: 如何查看当前基于哪个官方版本？
```bash
git log --oneline | grep -i "release\|version" | head -5
```

### Q: 如何放弃本地修改，强制同步官方版本？
```bash
git checkout main
git fetch upstream
git reset --hard upstream/main
git push origin main --force
```

### Q: 如何查看我做了哪些定制？
```bash
git diff upstream/main..develop
```

## 📚 相关文档

- [Dify 官方文档](https://docs.dify.ai/)
- [Dify GitHub](https://github.com/langgenius/dify)
- [Git 分支管理最佳实践](https://nvie.com/posts/a-successful-git-branching-model/)
