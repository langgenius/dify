from dify_app import DifyApp


def init_app(app: DifyApp):
    from message_events import event_handlers  # noqa: F401 # pyright: ignore[reportUnusedImport]
