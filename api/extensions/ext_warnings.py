from dify_app import DifyApp


def init_app(app: DifyApp):
    import warnings

    warnings.simplefilter("ignore", ResourceWarning)

    # Ignore DeprecationWarning from pkg_resources.declare_namespace (google-cloud libraries)
    warnings.filterwarnings(
        "ignore",
        category=DeprecationWarning,
        message=".*pkg_resources.declare_namespace.*",
    )

    # Ignore SyntaxWarning from jieba library (invalid escape sequences)
    warnings.filterwarnings(
        "ignore",
        category=SyntaxWarning,
        module="jieba.*",
    )
