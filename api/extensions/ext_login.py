import flask_login

login_manager = flask_login.LoginManager()


def init_app(app):
    login_manager.init_app(app)
