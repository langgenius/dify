from configs import dify_config
from configs.secret_key import resolve_secret_key
from dify_app import DifyApp


def init_app(app: DifyApp) -> None:
    """Resolve SECRET_KEY after config loading and before session/login setup."""
    secret_key = dify_config.SECRET_KEY
    if not secret_key:
        secret_key = resolve_secret_key(secret_key)
    dify_config.SECRET_KEY = secret_key
    app.config["SECRET_KEY"] = secret_key
    app.secret_key = secret_key
