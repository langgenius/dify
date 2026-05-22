# 将 /explore/apps 页面变为空白页面

## 动机

用户希望 `/explore/apps` 探索页面不再展示 Dify 的精选示例应用，展现一个空白页面。但保留探索页的侧边栏菜单功能。

## 当前状态

- 顶部导航栏的"探索"按钮链接到 `/explore/apps`
- `/explore/apps` 页面在布局中渲染了左侧栏（Sidebar，已移除"应用库"菜单项）+ 右侧内容区（AppList 组件）
- AppList 组件展示了精选示例应用、搜索、分类、Banner、创建应用等功能

## 实施步骤

1. **修改 `/explore/apps` 的 page.tsx**
   - 将 `page.tsx` 中渲染 AppList 组件改为渲染一个空 div
   - 移除 AppList 的 import，只返回一个简单的空元素
   - 保留页面路由正常访问，但内容区域为空白

2. **重新构建前端 Docker 镜像**
   - 执行 `DOCKER_BUILDKIT=0 docker compose up -d --build web`

3. **验证**
   - 点击"探索"按钮，页面正常加载
   - 左侧栏正常显示
   - 右侧内容区域为空白
