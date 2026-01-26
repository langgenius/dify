import builtins
import pytest
from flask import Flask, Blueprint
from flask.views import MethodView

# 1. 基础依赖
from extensions import ext_fastopenapi
from models.engine import db

# 2. 导入路由容器
from controllers.fastopenapi import console_router 

# 3. 必须导入业务 Controller (触发路由加载)
import controllers.console.files 

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True

    # 数据库配置
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    db.init_app(app)

    # =================================================================
    # 🔍 自动探测 Blueprint (关键修复)
    # =================================================================
    # console_router 是一个 FlaskRouter 对象，我们需要找到它内部的 Flask Blueprint
    
    # 1. 尝试常见属性名
    real_bp = None
    possible_attrs = ["blueprint", "_blueprint", "flask_blueprint", "bp", "router"]
    
    for attr in possible_attrs:
        if hasattr(console_router, attr):
            candidate = getattr(console_router, attr)
            if isinstance(candidate, Blueprint):
                real_bp = candidate
                print(f"✅ Found blueprint in attribute: '{attr}'")
                break
    
    # 2. 如果都没找到，打印所有属性供调试 (这会显示在 CI 日志中)
    if not real_bp:
        print("\n" + "="*50)
        print("❌ ERROR: Could not find Blueprint in console_router!")
        print("Available attributes:", dir(console_router))
        print("="*50 + "\n")
        # 暂时创建一个空的 Blueprint 防止 AttributeError 直接崩溃，以便你能看到上面的打印信息
        real_bp = Blueprint("dummy", __name__)

    # 3. 注册真正的 Blueprint
    app.register_blueprint(real_bp, url_prefix="/console/api")

    with app.app_context():
        yield app


def test_console_files_fastopenapi_get_upload_config(app: Flask, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("controllers.console.wraps.dify_config.EDITION", "CLOUD")
    ext_fastopenapi.init_app(app)

    monkeypatch.setattr("controllers.console.files.setup_required", lambda f: f)
    monkeypatch.setattr("controllers.console.files.login_required", lambda f: f)
    monkeypatch.setattr("controllers.console.files.account_initialization_required", lambda f: f)

    client = app.test_client()
    response = client.get("/console/api/files/upload")

    # 调试信息
    if response.status_code == 404:
        print("\n[Debug] 404 Error - Current Routes:")
        print(app.url_map)

    assert response.status_code == 200
    data = response.get_json()
    assert "file_size_limit" in data
    assert "batch_count_limit" in data


def test_console_files_fastopenapi_get_support_types(app: Flask, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("controllers.console.wraps.dify_config.EDITION", "CLOUD")
    ext_fastopenapi.init_app(app)

    monkeypatch.setattr("controllers.console.files.setup_required", lambda f: f)
    monkeypatch.setattr("controllers.console.files.login_required", lambda f: f)
    monkeypatch.setattr("controllers.console.files.account_initialization_required", lambda f: f)

    client = app.test_client()
    response = client.get("/console/api/files/support-type")

    assert response.status_code == 200
    data = response.get_json()
    assert "allowed_extensions" in data
