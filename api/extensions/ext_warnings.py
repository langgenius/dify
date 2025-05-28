from dify_app import DifyApp


def init_app(app: DifyApp):
    import warnings

    warnings.simplefilter("ignore", ResourceWarning)
