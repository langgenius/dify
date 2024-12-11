from configs import dify_config
from dify_app import DifyApp


def init_app(app: DifyApp):
    if dify_config.RESPECT_XFORWARD_HEADERS_ENABLED:
        from werkzeug.middleware.proxy_fix import ProxyFix

        app.wsgi_app = ProxyFix(app.wsgi_app)
