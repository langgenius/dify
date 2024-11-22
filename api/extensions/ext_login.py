import flask_login  # type: ignore

login_manager = flask_login.LoginManager()


def init_app(app):
    login_manager.init_app(app)
