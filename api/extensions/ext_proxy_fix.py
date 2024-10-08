from flask import Flask


def init_app(app: Flask):
    if app.config.get("RESPECT_XFORWARD_HEADERS_ENABLED"):
        from werkzeug.middleware.proxy_fix import ProxyFix

        app.wsgi_app = ProxyFix(app.wsgi_app)
