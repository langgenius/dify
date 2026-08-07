"""Synthetic source-to-sink flows used to regression-test Pysa rules."""


def user_source() -> str:
    return "user-controlled"


def external_source() -> str:
    return "external"


def rce_sink(value: str) -> None: ...
def sql_sink(value: str) -> None: ...
def xss_sink(value: str) -> None: ...
def filesystem_sink(value: str) -> None: ...
def http_sink(value: str) -> None: ...
def redirect_sink(value: str) -> None: ...
def import_sink(value: str) -> None: ...
def command_sink(value: str) -> None: ...
def deserialize_sink(value: str) -> None: ...
def template_sink(value: str) -> None: ...


def positive_rce() -> None:
    rce_sink(user_source())


def positive_external_rce() -> None:
    rce_sink(external_source())


def positive_sql() -> None:
    sql_sink(user_source())


def positive_xss() -> None:
    xss_sink(user_source())


def positive_filesystem() -> None:
    filesystem_sink(user_source())


def positive_http() -> None:
    http_sink(user_source())


def positive_redirect() -> None:
    redirect_sink(user_source())


def positive_import() -> None:
    import_sink(user_source())


def positive_command() -> None:
    command_sink(user_source())


def positive_deserialize() -> None:
    deserialize_sink(user_source())


def positive_template() -> None:
    template_sink(user_source())


def negative_rce() -> None:
    rce_sink("safe")


def negative_sql() -> None:
    sql_sink("safe")


def negative_xss() -> None:
    xss_sink("safe")


def negative_filesystem() -> None:
    filesystem_sink("safe")


def negative_http() -> None:
    http_sink("safe")


def negative_redirect() -> None:
    redirect_sink("safe")


def negative_import() -> None:
    import_sink("safe")


def negative_command() -> None:
    command_sink("safe")


def negative_deserialize() -> None:
    deserialize_sink("safe")


def negative_template() -> None:
    template_sink("safe")
