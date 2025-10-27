# 启动后端并配置 CORS

## 问题
前端访问后端 API 时出现 CORS（跨域）错误。

## 解决方案

### 方式 1：使用环境变量启动（推荐）

```bash
cd /Users/sunfuwei/IdeaProjects/dify-1/api

# 设置 CORS 环境变量后启动
CONSOLE_CORS_ALLOW_ORIGINS="*" uv run --project api --dev flask run --host 0.0.0.0 --port 5001 --debug
```

### 方式 2：创建 .env 文件

在 `api/` 目录下创建 `.env` 文件（如果不存在）：

```bash
cd /Users/sunfuwei/IdeaProjects/dify-1/api

# 创建或编辑 .env 文件
cat >> .env << 'EOF'

# CORS 配置（允许所有源，仅用于开发环境）
CONSOLE_CORS_ALLOW_ORIGINS=*
EOF
```

然后正常启动后端：

```bash
uv run --project api --dev flask run --host 0.0.0.0 --port 5001 --debug
```

### 方式 3：Docker 启动（生产环境）

在 `docker-compose.yaml` 或环境变量中设置：

```yaml
environment:
  CONSOLE_CORS_ALLOW_ORIGINS: "*"  # 开发环境
  # 或者指定具体域名（生产环境）
  # CONSOLE_CORS_ALLOW_ORIGINS: "http://81.70.28.229:3000"
```

## 验证配置

启动后端后，检查日志中是否有 CORS 配置信息：

```bash
# 查看配置是否加载
curl -I http://localhost:5001/console/api/workspaces/current/filter-rules
```

响应头中应该包含：
```
Access-Control-Allow-Origin: *
```

## 生产环境安全建议

⚠️ **不要在生产环境使用 `*`**，应该指定具体的域名：

```bash
# 开发环境
CONSOLE_CORS_ALLOW_ORIGINS=*

# 生产环境（指定具体域名）
CONSOLE_CORS_ALLOW_ORIGINS=http://81.70.28.229:3000,https://yourdomain.com
```

## 常见问题

### Q: 为什么 curl 不报 CORS 错误？
A: CORS 是浏览器的安全策略，curl 等命令行工具不会检查 CORS。只有浏览器会报 CORS 错误。

### Q: 设置后还是报错？
A: 确保：
1. 后端已重启
2. 浏览器已清除缓存（Cmd+Shift+R / Ctrl+Shift+R）
3. 环境变量确实被加载了

### Q: URL 中有重复的 /console/api？
A: 检查前端的 API 基础路径配置，应该是：
```
/console/api/workspaces/current/filter-rules
```
而不是：
```
/console/api/console/api/workspaces/current/filter-rules
```

