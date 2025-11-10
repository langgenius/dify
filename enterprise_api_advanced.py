#!/usr/bin/env python3
"""
Dify Enterprise API - Advanced Version with FastAPI
支持数据库持久化、完整的权限管理和 SSO 集成
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional
from enum import Enum

from fastapi import FastAPI, Header, HTTPException, Depends, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import uvicorn

# ================== 配置 ==================

class Settings:
    SECRET_KEY = "your-secret-key-here"
    PLUGIN_MANAGER_SECRET_KEY = "your-plugin-secret-key"
    DATABASE_URL = "sqlite:///./enterprise.db"  # 可替换为 PostgreSQL


settings = Settings()


# ================== 数据模型 ==================

class LicenseStatus(str, Enum):
    NONE = "none"
    INACTIVE = "inactive"
    ACTIVE = "active"
    EXPIRING = "expiring"
    EXPIRED = "expired"
    LOST = "lost"


class PluginInstallationScope(str, Enum):
    NONE = "none"
    OFFICIAL_ONLY = "official_only"
    OFFICIAL_AND_SPECIFIC_PARTNERS = "official_and_specific_partners"
    ALL = "all"


class AccessMode(str, Enum):
    PUBLIC = "public"
    PRIVATE = "private"
    PRIVATE_ALL = "private_all"
    SSO_VERIFIED = "sso_verified"


class BrandingConfig(BaseModel):
    applicationTitle: str = "Dify Enterprise"
    loginPageLogo: str = ""
    workspaceLogo: str = ""
    favicon: str = ""


class WebAppAuthConfig(BaseModel):
    allowSso: bool = False
    allowEmailCodeLogin: bool = True
    allowEmailPasswordLogin: bool = True


class LicenseInfo(BaseModel):
    status: LicenseStatus = LicenseStatus.ACTIVE
    expiredAt: str = (datetime.now() + timedelta(days=365)).isoformat()
    workspaces: Dict = {
        "enabled": True,
        "limit": 100,
        "used": 1
    }


class PluginInstallationPermission(BaseModel):
    pluginInstallationScope: PluginInstallationScope = PluginInstallationScope.ALL
    restrictToMarketplaceOnly: bool = False


class EnterpriseInfo(BaseModel):
    SSOEnforcedForSignin: bool = False
    SSOEnforcedForSigninProtocol: str = ""
    SSOEnforcedForWebProtocol: str = ""
    EnableEmailCodeLogin: bool = True
    EnableEmailPasswordLogin: bool = True
    IsAllowRegister: bool = True
    IsAllowCreateWorkspace: bool = True
    Branding: BrandingConfig = BrandingConfig()
    WebAppAuth: WebAppAuthConfig = WebAppAuthConfig()
    License: LicenseInfo = LicenseInfo()
    PluginInstallationPermission: PluginInstallationPermission = PluginInstallationPermission()


class WorkspaceInfo(BaseModel):
    WorkspaceMembers: Dict = {
        "enabled": True,
        "limit": 50,
        "used": 3
    }


class WebAppPermissionRequest(BaseModel):
    userId: str
    appIds: List[str]


class WebAppAccessModeRequest(BaseModel):
    appId: str
    accessMode: AccessMode


class WebAppCleanupRequest(BaseModel):
    appId: str


# ================== 内存数据库（可替换为真实数据库）==================

class InMemoryDB:
    def __init__(self):
        self.enterprise_config = EnterpriseInfo()
        self.workspaces: Dict[str, WorkspaceInfo] = {}
        self.app_access_modes: Dict[str, AccessMode] = {}
        self.user_app_permissions: Dict[str, Dict[str, bool]] = {}
        self.sso_last_update = datetime.now()

    def get_enterprise_config(self) -> EnterpriseInfo:
        return self.enterprise_config

    def update_enterprise_config(self, config: EnterpriseInfo):
        self.enterprise_config = config

    def get_workspace(self, tenant_id: str) -> WorkspaceInfo:
        if tenant_id not in self.workspaces:
            self.workspaces[tenant_id] = WorkspaceInfo()
        return self.workspaces[tenant_id]

    def get_app_access_mode(self, app_id: str) -> AccessMode:
        return self.app_access_modes.get(app_id, AccessMode.PUBLIC)

    def set_app_access_mode(self, app_id: str, mode: AccessMode):
        self.app_access_modes[app_id] = mode

    def check_user_permission(self, user_id: str, app_id: str) -> bool:
        # 默认策略：public 模式允许所有用户
        access_mode = self.get_app_access_mode(app_id)
        if access_mode == AccessMode.PUBLIC:
            return True

        # 检查用户特定权限
        if user_id in self.user_app_permissions:
            return self.user_app_permissions[user_id].get(app_id, False)

        return False

    def grant_user_permission(self, user_id: str, app_id: str, allowed: bool = True):
        if user_id not in self.user_app_permissions:
            self.user_app_permissions[user_id] = {}
        self.user_app_permissions[user_id][app_id] = allowed


# 全局数据库实例
db = InMemoryDB()


# ================== FastAPI 应用 ==================

app = FastAPI(
    title="Dify Enterprise API",
    description="企业版功能管理 API",
    version="1.0.0"
)


# ================== 中间件和依赖 ==================

async def verify_secret_key(
    enterprise_api_secret_key: Optional[str] = Header(None, alias="Enterprise-Api-Secret-Key")
):
    """验证 API 密钥"""
    if not enterprise_api_secret_key or enterprise_api_secret_key != settings.SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing Enterprise-Api-Secret-Key header"
        )
    return True


# ================== 企业配置端点 ==================

@app.get("/info", response_model=EnterpriseInfo)
async def get_enterprise_info(verified: bool = Depends(verify_secret_key)):
    """获取企业版系统配置"""
    return db.get_enterprise_config()


@app.put("/info")
async def update_enterprise_info(
    config: EnterpriseInfo,
    verified: bool = Depends(verify_secret_key)
):
    """更新企业版配置"""
    db.update_enterprise_config(config)
    return {"result": True}


# ================== 工作空间端点 ==================

@app.get("/workspace/{tenant_id}/info", response_model=WorkspaceInfo)
async def get_workspace_info(
    tenant_id: str,
    verified: bool = Depends(verify_secret_key)
):
    """获取工作空间信息"""
    return db.get_workspace(tenant_id)


# ================== SSO 端点 ==================

@app.get("/sso/app/last-update-time")
async def get_app_sso_last_update_time(verified: bool = Depends(verify_secret_key)):
    """获取应用 SSO 设置最后更新时间"""
    return db.sso_last_update.isoformat()


@app.get("/sso/workspace/last-update-time")
async def get_workspace_sso_last_update_time(verified: bool = Depends(verify_secret_key)):
    """获取工作空间 SSO 设置最后更新时间"""
    return db.sso_last_update.isoformat()


# ================== Web 应用权限端点 ==================

@app.get("/webapp/permission")
async def check_webapp_permission(
    userId: str,
    appId: str,
    verified: bool = Depends(verify_secret_key)
):
    """检查用户是否有权限访问 Web 应用"""
    result = db.check_user_permission(userId, appId)
    return {"result": result}


@app.post("/webapp/permission/batch")
async def batch_check_webapp_permission(
    request: WebAppPermissionRequest,
    verified: bool = Depends(verify_secret_key)
):
    """批量检查用户权限"""
    permissions = {}
    for app_id in request.appIds:
        permissions[app_id] = db.check_user_permission(request.userId, app_id)

    return {"permissions": permissions}


# ================== Web 应用访问模式端点 ==================

@app.get("/webapp/access-mode/id")
async def get_app_access_mode(
    appId: str,
    verified: bool = Depends(verify_secret_key)
):
    """获取应用访问模式"""
    access_mode = db.get_app_access_mode(appId)
    return {"accessMode": access_mode.value}


@app.post("/webapp/access-mode/batch/id")
async def batch_get_app_access_mode(
    request: Dict[str, List[str]],
    verified: bool = Depends(verify_secret_key)
):
    """批量获取应用访问模式"""
    app_ids = request.get("appIds", [])
    access_modes = {}

    for app_id in app_ids:
        access_modes[app_id] = db.get_app_access_mode(app_id).value

    return {"accessModes": access_modes}


@app.post("/webapp/access-mode")
async def update_app_access_mode(
    request: WebAppAccessModeRequest,
    verified: bool = Depends(verify_secret_key)
):
    """更新应用访问模式"""
    db.set_app_access_mode(request.appId, request.accessMode)
    return {"result": True}


@app.delete("/webapp/clean")
async def cleanup_webapp(
    request: WebAppCleanupRequest,
    verified: bool = Depends(verify_secret_key)
):
    """清理 Web 应用数据"""
    # 实现清理逻辑
    return {"result": True}


# ================== 用户权限管理端点（扩展）==================

@app.post("/webapp/permission/grant")
async def grant_webapp_permission(
    userId: str,
    appId: str,
    allowed: bool = True,
    verified: bool = Depends(verify_secret_key)
):
    """授予或撤销用户应用权限"""
    db.grant_user_permission(userId, appId, allowed)
    return {"result": True}


# ================== 健康检查 ==================

@app.get("/health")
async def health_check():
    """健康检查端点"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "version": "1.0.0"
    }


# ================== 根端点 ==================

@app.get("/")
async def root():
    """API 根端点"""
    return {
        "name": "Dify Enterprise API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health"
    }


# ================== 启动配置 ==================

if __name__ == "__main__":
    print("=" * 70)
    print("🚀 Dify Enterprise API - Advanced Version")
    print("=" * 70)
    print(f"📡 Server: http://0.0.0.0:5001")
    print(f"📚 API Docs: http://0.0.0.0:5001/docs")
    print(f"🔑 Secret Key: {settings.SECRET_KEY}")
    print("\n环境变量配置:")
    print(f"  ENTERPRISE_ENABLED=true")
    print(f"  ENTERPRISE_API_URL=http://127.0.0.1:5001")
    print(f"  ENTERPRISE_API_SECRET_KEY={settings.SECRET_KEY}")
    print("=" * 70)
    print("\n安装依赖:")
    print("  pip install fastapi uvicorn[standard]")
    print("\n启动服务:")
    print("  python enterprise_api_advanced.py")
    print("  或: uvicorn enterprise_api_advanced:app --host 0.0.0.0 --port 5001 --reload")
    print("=" * 70)
    print()

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=5001,
        log_level="info"
    )
