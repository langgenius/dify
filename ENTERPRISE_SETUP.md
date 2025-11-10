# Dify 企业版功能启用指南

## 🎯 方案 1：使用 Mock API（推荐用于开发测试）

### 步骤 1：启动 Mock 企业 API 服务

```bash
# 安装依赖
pip install flask

# 启动 Mock 服务
python enterprise_mock_api.py
```

服务将运行在 `http://127.0.0.1:5001`

### 步骤 2：配置 Dify 环境变量

在 `api/.env` 文件中添加或修改：

```bash
# 启用企业版功能
ENTERPRISE_ENABLED=true

# 企业 API 配置
ENTERPRISE_API_URL=http://127.0.0.1:5001
ENTERPRISE_API_SECRET_KEY=your-secret-key-here

# 可选：允许替换 Logo
CAN_REPLACE_LOGO=true
```

### 步骤 3：重启 Dify 服务

```bash
# Docker 方式
cd docker
docker-compose restart api worker web

# 或手动方式
cd api
uv run --project . flask run --reload
```

### 步骤 4：验证企业功能

访问 Dify 控制台，您应该能看到：

✅ **系统设置** → **品牌定制** 选项
✅ **系统设置** → **SSO 配置** 选项
✅ **应用设置** → **访问控制** 选项
✅ Web 应用版权信息已移除
✅ **插件管理** 功能已启用
✅ **知识库流水线** 发布功能

---

## 🔧 方案 2：自定义企业 API 服务

如果您需要更复杂的权限控制和持久化存储，可以基于 `enterprise_mock_api.py` 扩展：

### 推荐技术栈

- **框架**: FastAPI（异步支持，更好的性能）
- **数据库**: PostgreSQL 或 MySQL
- **认证**: JWT + Redis
- **部署**: Docker + Nginx

### 需要实现的功能模块

1. **许可证管理**
   - 许可证生成与验证
   - 过期时间管理
   - 工作空间限制

2. **SSO 集成**
   - SAML 2.0 / OAuth 2.0 / OIDC
   - 用户身份映射
   - 会话管理

3. **访问控制**
   - 基于角色的访问控制 (RBAC)
   - 应用级权限管理
   - 用户-应用关系维护

4. **品牌定制**
   - Logo 文件存储
   - 配置持久化
   - CDN 集成

5. **插件策略**
   - 插件白名单管理
   - 凭证策略验证
   - 市场限制控制

### FastAPI 示例框架

```python
from fastapi import FastAPI, Header, HTTPException, Depends
from sqlalchemy.orm import Session
import databases

app = FastAPI()

async def verify_secret_key(
    enterprise_api_secret_key: str = Header(...)
):
    if enterprise_api_secret_key != settings.SECRET_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return True

@app.get("/info")
async def get_info(verified: bool = Depends(verify_secret_key)):
    # 从数据库读取配置
    config = await db.fetch_one("SELECT * FROM enterprise_config")
    return config

@app.get("/workspace/{tenant_id}/info")
async def get_workspace_info(
    tenant_id: str,
    verified: bool = Depends(verify_secret_key)
):
    # 查询工作空间信息
    workspace = await db.fetch_one(
        "SELECT * FROM workspaces WHERE id = :id",
        {"id": tenant_id}
    )
    return workspace
```

---

## 🏢 方案 3：联系 Dify 官方

如果您需要用于生产环境的完整企业版功能，建议：

### 官方渠道

📧 **邮箱**: business@dify.ai
📝 **主题**: 企业版许可咨询
🌐 **官网**: https://dify.ai/pricing

### 官方企业版优势

✅ 官方技术支持
✅ 定期安全更新
✅ 完整的 SSO 集成
✅ SLA 保障
✅ 合规性支持
✅ 专业培训服务

---

## 📊 功能对照表

| 功能 | 社区版 | Mock API | 完整企业版 |
|------|--------|----------|-----------|
| 基础 LLM 应用 | ✅ | ✅ | ✅ |
| RAG 知识库 | ✅ | ✅ | ✅ |
| 工作流编排 | ✅ | ✅ | ✅ |
| 品牌定制 | ❌ | ✅ | ✅ |
| SSO 登录 | ❌ | 🟡 基础 | ✅ 完整 |
| 访问控制 | ❌ | 🟡 基础 | ✅ RBAC |
| 插件管理 | ✅ | ✅ | ✅ |
| 许可证管理 | ❌ | 🟡 Mock | ✅ 完整 |
| 技术支持 | 社区 | 自行维护 | 官方 SLA |
| 合规认证 | ❌ | ❌ | ✅ |

---

## 🔍 企业功能详解

### 1. 品牌定制 (api/services/feature_service.py:200)

启用后可自定义：
- 应用标题
- 登录页 Logo
- 工作空间 Logo
- 网站图标 (Favicon)
- 移除"Powered by Dify"版权信息

### 2. Web 应用访问控制 (api/services/enterprise/enterprise_service.py:47)

**访问模式**:
- `public`: 公开访问，无需认证
- `private`: 私有访问，需要用户认证
- `private_all`: 全私有，限制特定用户
- `sso_verified`: 仅 SSO 验证用户

### 3. 许可证管理 (api/controllers/console/wraps.py:225)

**许可证状态**:
- `active`: 活跃（正常使用）
- `inactive`: 未激活
- `expired`: 已过期
- `expiring`: 即将过期（30天内）
- `lost`: 许可证丢失

**装饰器使用**:
```python
@only_edition_enterprise  # 非企业版返回 404
@enterprise_license_required  # 验证许可证
def enterprise_feature():
    pass
```

### 4. SSO 单点登录

支持的协议：
- SAML 2.0
- OAuth 2.0
- OpenID Connect (OIDC)

配置项：
- 强制 SSO 登录
- 应用级 SSO
- 工作空间级 SSO
- SSO 协议选择

### 5. 插件策略 (api/services/enterprise/plugin_manager_service.py)

**安装范围**:
- `none`: 禁止所有插件
- `official_only`: 仅官方插件
- `official_and_specific_partners`: 官方+合作伙伴
- `all`: 允许所有插件

**限制选项**:
- 仅市场插件
- 凭证策略验证
- 包大小限制

### 6. 知识库流水线 (api/services/feature_service.py:178)

启用后可以：
- 发布 RAG 流水线
- 导出知识库配置
- 版本管理
- 批量操作

---

## ⚠️ 重要提示

### 开发环境

✅ **可以使用 Mock API** 进行功能开发和测试
✅ **适合个人学习** 和功能探索
✅ **内部演示** 和 POC

### 生产环境

⚠️ **不建议使用 Mock API** 用于生产
⚠️ **安全性无保障** - Mock 服务缺少完整认证
⚠️ **无技术支持** - 出现问题需自行解决
⚠️ **合规风险** - 可能违反软件许可协议

**生产环境强烈建议联系 Dify 官方获取正式许可证**

---

## 🐛 故障排查

### 问题 1: 企业功能未生效

**检查清单**:
```bash
# 1. 验证环境变量
grep ENTERPRISE api/.env

# 2. 测试企业 API 连接
curl -H "Enterprise-Api-Secret-Key: your-secret-key-here" \
     http://127.0.0.1:5001/info

# 3. 查看日志
docker logs dify-api
```

### 问题 2: Mock API 无法访问

**解决方案**:
```bash
# 检查端口占用
lsof -i :5001

# 检查防火墙
sudo ufw status

# 使用 Docker 方式运行
docker run -d -p 5001:5001 \
  -v $(pwd)/enterprise_mock_api.py:/app/main.py \
  python:3.10 python /app/main.py
```

### 问题 3: 许可证显示为 inactive

**修改 Mock API**:
```python
# 在 enterprise_mock_api.py 中
"License": {
    "status": "active",  # 确保为 active
    "expiredAt": "2099-12-31T23:59:59Z"  # 设置远期日期
}
```

---

## 📚 相关代码文件

### 核心配置
- `api/configs/enterprise/__init__.py:11` - ENTERPRISE_ENABLED 开关
- `api/configs/deploy/__init__.py:12` - 部署版本配置

### 企业服务
- `api/services/enterprise/base.py:46` - 企业 API 请求封装
- `api/services/enterprise/enterprise_service.py` - 企业服务实现
- `api/services/enterprise/plugin_manager_service.py` - 插件管理

### 特性管理
- `api/services/feature_service.py:176` - 企业功能启用逻辑
- `api/services/feature_service.py:199` - 系统级企业功能

### 访问控制
- `api/controllers/console/wraps.py:225` - 许可证验证装饰器
- `api/controllers/console/wraps.py:100` - 企业版限制装饰器

### 前端组件
- `web/app/components/billing/` - 企业版 UI 组件
- `web/i18n/en-US/` - 国际化文本

---

## 🤝 贡献

如果您改进了 Mock API 或有更好的实现方案，欢迎：

1. 提交 Issue 分享经验
2. 创建 Pull Request 贡献代码
3. 在社区讨论最佳实践

---

## 📄 许可声明

**重要**: 本文档中的 Mock API 仅用于学习和开发测试目的。在生产环境使用企业功能前，请务必：

1. 阅读 Dify 的许可协议
2. 联系官方获取正式授权
3. 遵守相关法律法规

**Dify 官方联系方式**: business@dify.ai
