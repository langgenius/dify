import pytest

from services.web_login_redirect import (
    resolve_console_login_redirect,
    resolve_personal_login_redirect,
    resolve_web_login_redirect,
)


@pytest.mark.parametrize("prefix", ["https://apps.example.com/share", "/share", ""])
def test_preserves_web_app_query_fragment_and_configured_base_path(prefix: str) -> None:
    path = "/chatbot/app-code?input=a%26b&input=c+%20d#message-1"
    result = resolve_web_login_redirect(
        f"{prefix}{path}",
        app_web_url="https://apps.example.com/share",
        console_web_url="https://console.example.com",
    )
    assert result == f"https://apps.example.com/share{path}"


def test_relative_deployment_keeps_return_path_relative() -> None:
    result = resolve_web_login_redirect("/workflow/app-code?q=1#result", app_web_url="", console_web_url="")
    assert result == "/workflow/app-code?q=1#result"


@pytest.mark.parametrize(
    "target",
    [
        "https://evil.example/chatbot/app-code",
        "https://apps.example.com.evil.example/chatbot/app-code",
        "https://user@apps.example.com/chatbot/app-code",
        "https://apps.example.com:444/chatbot/app-code",
        "http://apps.example.com/chatbot/app-code",
        "//apps.example.com/chatbot/app-code",
        "///evil.example/chatbot/app-code",
        r"/\evil.example/chatbot/app-code",
        "/%2f%2fevil.example/chatbot/app-code",
        "/chatbot/app-code/../signin",
        "/chatbot/%2e%2e",
        "/chatbot/app-code\n",
        " https://apps.example.com/chatbot/app-code",
        "https://[invalid/chatbot/app-code",
        "/webapp-signin?redirect_url=/chatbot/app-code",
        "/apps",
        "/environment/workflow/app-code",
        "javascript:alert(1)",
    ],
)
def test_rejects_untrusted_or_non_web_app_targets(target: str) -> None:
    assert (
        resolve_web_login_redirect(
            target, app_web_url="https://apps.example.com", console_web_url="https://console.example.com"
        )
        is None
    )


def test_default_https_port_matches_browser_normalized_origin() -> None:
    result = resolve_web_login_redirect(
        "https://apps.example.com/workflow/app-code", app_web_url="https://apps.example.com:443", console_web_url=""
    )
    assert result == "https://apps.example.com:443/workflow/app-code"


@pytest.mark.parametrize("prefix", ["https://apps.example.com/share", "/share", ""])
@pytest.mark.parametrize("route", ["my-apps", "connections", "connections/langgenius%2Fgoogle%2Fgmail"])
def test_personal_redirect_preserves_query_fragment_and_configured_base_path(prefix: str, route: str) -> None:
    path = f"/{route}?sort=recent&q=a%26b#details"
    result = resolve_personal_login_redirect(
        f"{prefix}{path}",
        app_web_url="https://apps.example.com/share/",
        console_web_url="https://console.example.com/console",
    )
    assert result == f"https://apps.example.com/share{path}"


@pytest.mark.parametrize(
    ("app_web_url", "console_web_url", "expected"),
    [
        ("https://apps.example.com/share/", "https://console.example.com/console", "https://apps.example.com/share"),
        ("", "https://console.example.com/console", "https://console.example.com/console"),
        ("/share", "/console", "/share"),
        ("", "", ""),
    ],
)
def test_missing_personal_redirect_defaults_to_my_apps(app_web_url: str, console_web_url: str, expected: str) -> None:
    assert (
        resolve_personal_login_redirect(None, app_web_url=app_web_url, console_web_url=console_web_url)
        == f"{expected}/my-apps"
    )


@pytest.mark.parametrize(
    "target",
    [
        "",
        "https://evil.example/connections",
        "https://console.example.com.evil.example/connections",
        "https://user@console.example.com/connections",
        "https://console.example.com:444/connections",
        "http://console.example.com/connections",
        "https://[invalid/connections",
        "//evil.example/connections",
        "///evil.example/connections",
        r"/\evil.example/connections",
        "/%2f%2fevil.example/connections",
        "/connections/../signin",
        "/connections/%2e%2e",
        "/connections/%2E",
        "/connections/provider\n",
        " /connections",
        "/signin?redirect_url=/connections",
        "/chatbot/app-code",
        "/apps",
        "connections",
        "javascript:alert(1)",
    ],
)
def test_personal_redirect_rejects_unsafe_or_non_personal_targets(target: str) -> None:
    assert (
        resolve_personal_login_redirect(
            target, app_web_url="https://apps.example.com/share", console_web_url="https://console.example.com"
        )
        is None
    )


def test_personal_absolute_redirect_requires_configured_base_path() -> None:
    assert (
        resolve_personal_login_redirect(
            "https://apps.example.com/connections",
            app_web_url="https://apps.example.com/share",
            console_web_url="https://console.example.com/dify",
        )
        is None
    )


@pytest.mark.parametrize("path", ["/apps?tag=a%26b#recent", "/console/apps?tag=a%26b#recent"])
def test_console_relative_redirect_uses_configured_origin_and_base_path(path: str) -> None:
    assert (
        resolve_console_login_redirect(path, console_web_url="https://console.example.com/console")
        == "https://console.example.com/console/apps?tag=a%26b#recent"
    )


@pytest.mark.parametrize("path", ["apps", "//external.example/apps", "/apps/../home", "/apps/%2e%2e/home"])
def test_console_rejects_invalid_relative_paths(path: str) -> None:
    assert resolve_console_login_redirect(path, console_web_url="https://console.example.com/console") is None


@pytest.mark.parametrize(
    "target",
    ["https://console.example.com/console/apps", "https://CONSOLE.example.com/console/apps"],
)
def test_console_absolute_redirect_is_rebuilt_from_configured_origin(target: str) -> None:
    assert (
        resolve_console_login_redirect(target, console_web_url="https://console.example.com/console")
        == "https://console.example.com/console/apps"
    )


@pytest.mark.parametrize(
    "target",
    [
        "https://evil.example/console/apps",
        "https://console.example.com.evil.example/console/apps",
        "https://console.example.com./console/apps",
        "https://console.example.com:444/console/apps",
        "http://console.example.com/console/apps",
        "https://user@console.example.com/console/apps",
        "https://:pass@console.example.com/console/apps",
        "//console.example.com/console/apps",
        "https://console.example.com/console/../apps",
        "https://console.example.com/console/%2e%2e/apps",
        "https://console.example.com/console/apps\\@evil.example",
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
    ],
)
def test_console_rejects_absolute_redirect_outside_configured_origin(target: str) -> None:
    assert resolve_console_login_redirect(target, console_web_url="https://console.example.com/console") is None
