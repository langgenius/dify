import builtins
from unittest.mock import Mock, patch

import pytest
from flask import Flask
from flask.views import MethodView

# [补丁2] 必须显式导入 Controller 以触发路由加载
from controllers.fastopenapi import console_router
from extensions import ext_fastopenapi

# [补丁1] 必须导入 db 和 路由
from models.engine import db

if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True

    # [补丁3] 配置内存数据库 (解决 "Flask app not registered" 报错)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    db.init_app(app)

    # [补丁4] 手动注册路由 (解决 404 报错)
    # 尝试找到 console_router 内部的 Blueprint
    bp = getattr(console_router, "blueprint", getattr(console_router, "_blueprint", None))
    if bp:
        app.register_blueprint(bp, url_prefix="/console/api")
    else:
        # 如果找不到 blueprint 属性，使用底层方法注册 (保底方案)
        if hasattr(console_router, "_routes"):
            for route in console_router._routes:
                path = route.path.replace("{", "<").replace("}", ">")
                app.add_url_rule(
                    f"/console/api{path}",
                    endpoint=route.endpoint.__name__,
                    view_func=route.endpoint,
                    methods=list(route.methods),
                )

    with app.app_context():
        yield app


def test_console_features_fastopenapi_get(app: Flask, monkeypatch: pytest.MonkeyPatch):
    # [补丁5] 欺骗 Config，让它以为是云端版 (解决 "no such table" 数据库报错)
    monkeypatch.setattr("controllers.console.wraps.dify_config.EDITION", "CLOUD")

    ext_fastopenapi.init_app(app)

    # 你的原始 Mock 逻辑 (完美保留)
    monkeypatch.setattr("controllers.console.feature.setup_required", lambda f: f)
    monkeypatch.setattr("controllers.console.feature.login_required", lambda f: f)
    monkeypatch.setattr("controllers.console.feature.account_initialization_required", lambda f: f)
    monkeypatch.setattr("controllers.console.feature.cloud_utm_record", lambda f: f)

    with (
        patch("controllers.console.feature.current_account_with_tenant", return_value=(object(), "tenant-id")),
        patch(
            "controllers.console.feature.FeatureService.get_features",
            # 保留你原本的 Mock 写法，这可以有效避开 Pydantic 序列化问题
            return_value=Mock(model_dump=lambda: {"enabled": True}),
        ),
    ):
        client = app.test_client()
        response = client.get("/console/api/features")

    assert response.status_code == 200
    assert response.get_json() == {"features": {"enabled": True}}


def test_console_system_features_fastopenapi_get(app: Flask, monkeypatch: pytest.MonkeyPatch):
    # 同样需要 Mock Config
    monkeypatch.setattr("controllers.console.wraps.dify_config.EDITION", "CLOUD")

    ext_fastopenapi.init_app(app)

    with patch(
        "controllers.console.feature.FeatureService.get_system_features",
        # 保留你原本的 Mock 写法
        return_value=Mock(model_dump=lambda: {"system": True}),
    ):
        client = app.test_client()
        response = client.get("/console/api/system-features")

    assert response.status_code == 200
    assert response.get_json() == {"features": {"system": True}}
