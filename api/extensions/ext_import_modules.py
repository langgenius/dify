from dify_app import DifyApp


def init_app(app: DifyApp):
    from events import event_handlers  # noqa: F401
    from models import account, dataset, model, source, task, tool, tools, web  # noqa: F401
