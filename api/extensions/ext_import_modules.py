from dify_app import DifyApp


def init_app(app: DifyApp):
    from events import event_handlers  # noqa: F401
