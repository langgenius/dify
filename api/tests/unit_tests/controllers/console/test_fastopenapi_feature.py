import builtins
import pytest
from flask import Flask
from flask.views import MethodView

# 1. 基础依赖
from extensions import ext_fastopenapi
from models.engine import db

# 2. 导入路由容器
from controllers.fastopenapi import console_router 

# 3. 【关键】必须显式导入业务 Controller
# 这会触发 @console_router.get(...)，把路由填入 console_router 中
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

    # 4. 【关键修复】注册 Blueprint
    # console_router 是一个 FlaskRouter 包装器，它不是 Blueprint。
    # 我们需要访问它的 .blueprint 属性来获取真正的 Flask Blueprint 对象。
    # 注意：这里需要根据你的 fastopenapi 版本确认是 .blueprint 还是其他属性，
    # 但在 Dify 中通常是 console_router.blueprint
    if hasattr(console_router, 'blueprint'):
        bp = console_router.blueprint
    else:
        # 兼容性处理：有些版本可能是直接把 router 当 blueprint 用（但显然这里不是）
        # 或者它可能叫 to_blueprint()
        # 我们先假设是 standard Dify pattern: .blueprint
        bp = getattr(console_router, 'blueprint', console_router)
        
    app.register_blueprint(bp, url_prefix="/console/api")

    with app.app_context():
        yield app


def test_console_files_fastopenapi_get_upload_config(app: Flask, monkeypatch: pytest.MonkeyPatch):
    # Mock 配置 (跳过数据库检查)
    monkeypatch.setattr("controllers.console.wraps.dify_config.EDITION", "CLOUD")

    # 初始化扩展
    ext_fastopenapi.init_app(app)

    # Mock 鉴权
    monkeypatch.setattr("controllers.console.files.setup_required", lambda f: f)
    monkeypatch.setattr("controllers.console.files.login_required", lambda f: f)
    monkeypatch.setattr("controllers.console.files.account_initialization_required", lambda f: f)

    client = app.test_client()
    response = client.get("/console/api/files/upload")

    # 调试：如果还是 404 或 500，打印输出
    if response.status_code != 200:
        print(f"\nError: {response.status_code}")
        if response.status_code == 404:
            print(app.url_map)
        if response.status_code == 500:
            print(response.get_data(as_text=True))

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
