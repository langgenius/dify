# 🚀 Dify 企业版功能快速启用指南

> **一键启用 Dify 企业版功能，支持 SSO、品牌定制、访问控制等高级特性**

---

## 📦 本方案包含的文件

| 文件 | 说明 | 用途 |
|------|------|------|
| `enterprise_mock_api.py` | 基础 Flask Mock API | 快速测试，适合学习 |
| `enterprise_api_advanced.py` | 进阶 FastAPI 服务 | 生产就绪，支持扩展 |
| `start_enterprise_mock.sh` | 一键启动脚本 | 自动配置和启动 |
| `test_enterprise_api.sh` | API 测试脚本 | 验证服务正常 |
| `ENTERPRISE_SETUP.md` | 详细文档 | 完整参考指南 |
| `.env.enterprise.example` | 环境变量模板 | 配置参考 |
| `requirements.enterprise.txt` | Python 依赖 | 安装依赖包 |
| `docker-compose.enterprise-mock.yaml` | Docker 配置 | 容器化部署 |

---

## ⚡ 快速开始（3 步搞定）

### 方式 1: 自动脚本（推荐）

```bash
# 下载或确保所有文件在 Dify 根目录

# 运行一键启动脚本
./start_enterprise_mock.sh

# 测试企业 API
./test_enterprise_api.sh
```

### 方式 2: 手动启动

```bash
# 1. 安装依赖
pip install flask

# 2. 启动 Mock API
python enterprise_mock_api.py

# 3. 配置 Dify（在另一个终端）
echo "ENTERPRISE_ENABLED=true" >> api/.env
echo "ENTERPRISE_API_URL=http://127.0.0.1:5001" >> api/.env
echo "ENTERPRISE_API_SECRET_KEY=your-secret-key-here" >> api/.env

# 4. 重启 Dify
cd docker && docker-compose restart api worker web
```

### 方式 3: Docker 部署

```bash
# 启动企业 Mock API
docker-compose -f docker-compose.enterprise-mock.yaml up -d

# 更新 Dify 配置（使用 Docker 网络内地址）
# 在 docker/.env 中添加：
# ENTERPRISE_API_URL=http://enterprise-api-mock:5001

# 重启 Dify
cd docker && docker-compose restart api worker
```

---

## 🎯 解锁的企业功能

启用后，您将获得以下企业级功能：

### ✨ 核心功能

| 功能 | 说明 | 位置 |
|------|------|------|
| 🎨 **品牌定制** | 自定义 Logo、标题、图标 | 系统设置 → 品牌定制 |
| 🔐 **SSO 单点登录** | SAML/OAuth/OIDC 集成 | 系统设置 → SSO 配置 |
| 🛡️ **访问控制** | 应用级权限管理 | 应用设置 → 访问控制 |
| 📜 **许可证管理** | 工作空间和成员限制 | 系统设置 → 许可证 |
| 🧩 **插件策略** | 插件安装范围控制 | 系统设置 → 插件管理 |
| 📊 **知识库增强** | RAG 流水线发布 | 知识库 → 发布 |
| ©️ **版权移除** | 去除"Powered by Dify" | 自动生效 |

### 🔐 访问模式

- **Public** - 公开访问，无需认证
- **Private** - 私有访问，需要登录
- **Private All** - 全私有，特定用户
- **SSO Verified** - 仅 SSO 用户

### 📊 许可证状态

- **Active** - 正常使用 ✅
- **Expiring** - 即将过期 ⚠️
- **Expired** - 已过期 ❌
- **Inactive** - 未激活
- **Lost** - 许可证丢失

---

## 🧪 验证企业功能

### 1. API 健康检查

```bash
curl http://127.0.0.1:5001/info \
  -H "Enterprise-Api-Secret-Key: your-secret-key-here" | jq
```

**预期输出**:
```json
{
  "License": {
    "status": "active",
    "expiredAt": "2025-12-31T23:59:59Z",
    "workspaces": {
      "enabled": true,
      "limit": 100,
      "used": 1
    }
  },
  "Branding": {
    "applicationTitle": "Dify Enterprise",
    ...
  }
}
```

### 2. 控制台验证

访问 Dify 控制台，检查以下功能是否可见：

✅ **系统设置** → 找到"品牌定制"选项
✅ **系统设置** → 找到"SSO 配置"选项
✅ **应用详情** → 找到"访问控制"选项
✅ Web 应用页面 → 版权信息已移除
✅ **插件市场** → 策略控制已启用

### 3. 完整测试

```bash
# 运行完整测试套件
./test_enterprise_api.sh

# 或指定自定义地址
./test_enterprise_api.sh http://your-api:5001 your-secret-key
```

---

## 🔧 故障排查

### 问题 1: 企业功能未生效

**原因**: 环境变量未正确配置

**解决**:
```bash
# 检查配置
grep ENTERPRISE api/.env

# 确保包含
ENTERPRISE_ENABLED=true
ENTERPRISE_API_URL=http://127.0.0.1:5001
ENTERPRISE_API_SECRET_KEY=your-secret-key-here

# 重启服务
docker-compose restart api worker web
```

### 问题 2: Mock API 无法连接

**原因**: 服务未启动或端口被占用

**解决**:
```bash
# 检查进程
ps aux | grep enterprise_mock_api

# 检查端口
lsof -i :5001

# 停止现有服务
pkill -f enterprise_mock_api

# 重新启动
python enterprise_mock_api.py
```

### 问题 3: Docker 网络问题

**原因**: 容器间网络不通

**解决**:
```bash
# 检查网络
docker network ls
docker network inspect docker_default

# 使用容器名称
ENTERPRISE_API_URL=http://enterprise-api-mock:5001

# 测试连通性
docker exec dify-api curl http://enterprise-api-mock:5001/info \
  -H "Enterprise-Api-Secret-Key: your-secret-key-here"
```

### 问题 4: 许可证显示 inactive

**原因**: Mock API 返回的状态不正确

**解决**:
```bash
# 编辑 enterprise_mock_api.py
# 找到 License 部分，确保：
"License": {
    "status": "active",  # 改为 active
    "expiredAt": "2099-12-31T23:59:59Z"  # 设置远期日期
}

# 重启 Mock API
pkill -f enterprise_mock_api && python enterprise_mock_api.py
```

---

## 📊 性能和扩展

### 基础版 vs 高级版

| 特性 | Flask 基础版 | FastAPI 高级版 |
|------|-------------|----------------|
| 性能 | 同步，中等 | 异步，高性能 |
| API 文档 | 无 | 自动生成 (/docs) |
| 数据持久化 | 内存 | 支持数据库 |
| 类型验证 | 基础 | 强类型（Pydantic） |
| 适用场景 | 开发测试 | 生产环境 |

### 切换到高级版

```bash
# 1. 安装依赖
pip install -r requirements.enterprise.txt

# 2. 启动 FastAPI 版本
python enterprise_api_advanced.py

# 或使用 uvicorn（推荐）
uvicorn enterprise_api_advanced:app --host 0.0.0.0 --port 5001 --reload

# 3. 访问 API 文档
open http://127.0.0.1:5001/docs
```

### 性能优化建议

1. **使用异步服务**: FastAPI + uvicorn
2. **添加缓存**: Redis 缓存频繁查询
3. **数据库优化**: PostgreSQL + 连接池
4. **负载均衡**: Nginx + 多实例
5. **监控告警**: Prometheus + Grafana

---

## 🏗️ 生产环境部署

### 架构建议

```
┌─────────────┐
│   Nginx     │  反向代理 + SSL
└──────┬──────┘
       │
┌──────▼──────────────────┐
│  Enterprise API Service │  FastAPI
│  - 认证授权             │
│  - 许可证管理           │
│  - SSO 集成             │
└──────┬──────────────────┘
       │
┌──────▼──────┐
│ PostgreSQL  │  持久化存储
└─────────────┘
```

### 安全清单

- [ ] 使用 HTTPS（SSL/TLS）
- [ ] 强密钥（32+ 字符）
- [ ] 定期轮换密钥
- [ ] IP 白名单
- [ ] 防火墙规则
- [ ] 审计日志
- [ ] 备份策略
- [ ] 监控告警

### 推荐配置

```nginx
# Nginx 配置示例
server {
    listen 443 ssl;
    server_name enterprise-api.your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 📚 参考资料

### 代码文件位置

- 企业配置: `api/configs/enterprise/__init__.py:11`
- 企业服务: `api/services/enterprise/enterprise_service.py`
- 特性管理: `api/services/feature_service.py:176`
- 访问控制: `api/controllers/console/wraps.py:225`

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ENTERPRISE_ENABLED` | `false` | 启用企业功能 |
| `ENTERPRISE_API_URL` | - | 企业 API 地址 |
| `ENTERPRISE_API_SECRET_KEY` | - | API 密钥 |
| `CAN_REPLACE_LOGO` | `false` | 允许替换 Logo |

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/info` | GET | 获取企业配置 |
| `/workspace/{id}/info` | GET | 工作空间信息 |
| `/sso/app/last-update-time` | GET | SSO 更新时间 |
| `/webapp/permission` | GET | 检查用户权限 |
| `/webapp/access-mode` | POST | 更新访问模式 |

---

## 🤝 获取官方支持

### 开发测试环境

✅ **免费使用** Mock API 进行开发
✅ **学习用途** 功能探索和测试
✅ **POC 演示** 内部概念验证

### 生产环境

⚠️ **强烈建议** 联系 Dify 官方获取正式许可

📧 **邮箱**: business@dify.ai
🌐 **官网**: https://dify.ai/pricing
💬 **社区**: https://discord.gg/dify

### 官方企业版优势

✅ 官方技术支持和 SLA
✅ 定期安全更新和补丁
✅ 完整的 SSO 集成支持
✅ 合规性认证和审计
✅ 专业培训和咨询服务
✅ 定制化开发支持

---

## 📝 许可说明

**重要提示**:

1. 本 Mock API 仅供**学习和开发测试**使用
2. **生产环境**请联系 Dify 官方获取正式许可证
3. 使用前请阅读并遵守 Dify 的[许可协议](https://github.com/langgenius/dify/blob/main/LICENSE)
4. 商业使用请联系 business@dify.ai

---

## 🎉 总结

通过本方案，您可以：

✅ **快速启用**企业版功能进行开发测试
✅ **深入理解** Dify 企业版架构和实现
✅ **自由定制**企业功能以满足特定需求
✅ **无缝过渡**到官方企业版

**下一步**:
1. 运行 `./start_enterprise_mock.sh` 启用企业功能
2. 阅读 `ENTERPRISE_SETUP.md` 了解详细配置
3. 探索企业功能并根据需求定制
4. 生产环境联系 business@dify.ai

---

**Made with ❤️ for Dify Community**

有问题或改进建议？欢迎提交 Issue 或 Pull Request！
