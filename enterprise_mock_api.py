#!/usr/bin/env python3
"""
Dify Enterprise API Mock Server
用于本地开发测试企业版功能的最小化 Mock 服务
"""

from datetime import datetime, timedelta
from flask import Flask, request, jsonify

app = Flask(__name__)

# 配置
ENTERPRISE_SECRET_KEY = "your-secret-key-here"  # 与 .env 中的 ENTERPRISE_API_SECRET_KEY 保持一致
PLUGIN_MANAGER_SECRET_KEY = "your-plugin-secret-key"


def verify_secret_key():
    """验证请求的密钥"""
    secret = request.headers.get('Enterprise-Api-Secret-Key')
    if secret != ENTERPRISE_SECRET_KEY:
        return False
    return True


@app.route('/info', methods=['GET'])
def get_info():
    """返回企业版系统配置"""
    if not verify_secret_key():
        return jsonify({"error": "Unauthorized"}), 401

    return jsonify({
        "SSOEnforcedForSignin": False,
        "SSOEnforcedForSigninProtocol": "",
        "SSOEnforcedForWebProtocol": "",
        "EnableEmailCodeLogin": True,
        "EnableEmailPasswordLogin": True,
        "IsAllowRegister": True,
        "IsAllowCreateWorkspace": True,
        "Branding": {
            "applicationTitle": "Dify Enterprise",
            "loginPageLogo": "",
            "workspaceLogo": "",
            "favicon": ""
        },
        "WebAppAuth": {
            "allowSso": False,
            "allowEmailCodeLogin": True,
            "allowEmailPasswordLogin": True
        },
        "License": {
            "status": "active",  # active, inactive, expired, expiring, lost
            "expiredAt": (datetime.now() + timedelta(days=365)).isoformat(),
            "workspaces": {
                "enabled": True,
                "limit": 100,  # 0 表示无限制
                "used": 1
            }
        },
        "PluginInstallationPermission": {
            "pluginInstallationScope": "all",  # none, official_only, official_and_specific_partners, all
            "restrictToMarketplaceOnly": False
        }
    })


@app.route('/workspace/<tenant_id>/info', methods=['GET'])
def get_workspace_info(tenant_id):
    """返回工作空间信息"""
    if not verify_secret_key():
        return jsonify({"error": "Unauthorized"}), 401

    return jsonify({
        "WorkspaceMembers": {
            "enabled": True,
            "limit": 50,  # 该工作空间最多 50 个成员
            "used": 3     # 当前已使用 3 个
        }
    })


@app.route('/sso/app/last-update-time', methods=['GET'])
def get_app_sso_last_update_time():
    """返回应用 SSO 设置的最后更新时间"""
    if not verify_secret_key():
        return jsonify({"error": "Unauthorized"}), 401

    # 返回 ISO 格式的 UTC 时间戳
    return jsonify(datetime.now().isoformat())


@app.route('/sso/workspace/last-update-time', methods=['GET'])
def get_workspace_sso_last_update_time():
    """返回工作空间 SSO 设置的最后更新时间"""
    if not verify_secret_key():
        return jsonify({"error": "Unauthorized"}), 401

    return jsonify(datetime.now().isoformat())


@app.route('/webapp/permission', methods=['GET'])
def check_webapp_permission():
    """检查用户是否有权限访问 Web 应用"""
    if not verify_secret_key():
        return jsonify({"error": "Unauthorized"}), 401

    user_id = request.args.get('userId')
    app_id = request.args.get('appId')

    # 默认允许所有用户访问所有应用
    return jsonify({
        "result": True
    })


@app.route('/webapp/permission/batch', methods=['POST'])
def batch_check_webapp_permission():
    """批量检查用户权限"""
    if not verify_secret_key():
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json
    user_id = data.get('userId')
    app_ids = data.get('appIds', [])

    # 默认允许访问所有应用
    permissions = {app_id: True for app_id in app_ids}

    return jsonify({
        "permissions": permissions
    })


@app.route('/webapp/access-mode/id', methods=['GET'])
def get_app_access_mode():
    """获取应用的访问模式"""
    if not verify_secret_key():
        return jsonify({"error": "Unauthorized"}), 401

    app_id = request.args.get('appId')

    return jsonify({
        "accessMode": "public"  # public, private, private_all, sso_verified
    })


@app.route('/webapp/access-mode/batch/id', methods=['POST'])
def batch_get_app_access_mode():
    """批量获取应用访问模式"""
    if not verify_secret_key():
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json
    app_ids = data.get('appIds', [])

    # 默认所有应用为 public 模式
    access_modes = {app_id: "public" for app_id in app_ids}

    return jsonify({
        "accessModes": access_modes
    })


@app.route('/webapp/access-mode', methods=['POST'])
def update_app_access_mode():
    """更新应用访问模式"""
    if not verify_secret_key():
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json
    app_id = data.get('appId')
    access_mode = data.get('accessMode')

    # 验证 access_mode
    if access_mode not in ['public', 'private', 'private_all']:
        return jsonify({"error": "Invalid access_mode"}), 400

    return jsonify({
        "result": True
    })


@app.route('/webapp/clean', methods=['DELETE'])
def cleanup_webapp():
    """清理 Web 应用数据"""
    if not verify_secret_key():
        return jsonify({"error": "Unauthorized"}), 401

    data = request.json
    app_id = data.get('appId')

    return jsonify({
        "result": True
    })


if __name__ == '__main__':
    print("=" * 60)
    print("🚀 Dify Enterprise API Mock Server")
    print("=" * 60)
    print(f"📡 Server: http://127.0.0.1:5001")
    print(f"🔑 Secret Key: {ENTERPRISE_SECRET_KEY}")
    print("\n请在 Dify 的 .env 文件中配置：")
    print(f"  ENTERPRISE_ENABLED=true")
    print(f"  ENTERPRISE_API_URL=http://127.0.0.1:5001")
    print(f"  ENTERPRISE_API_SECRET_KEY={ENTERPRISE_SECRET_KEY}")
    print("=" * 60)

    app.run(host='0.0.0.0', port=5001, debug=True)
