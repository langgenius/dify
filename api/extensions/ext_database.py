from dify_app import DifyApp
from models import db


def init_app(app: DifyApp):
    db.init_app(app)
