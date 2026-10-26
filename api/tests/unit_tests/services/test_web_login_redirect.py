import pytest

from services.web_login_redirect import resolve_web_login_redirect


@pytest.mark.parametrize("absolute", [True, False])
def test_preserves_web_app_query_fragment_and_configured_base_path(absolute: bool) -> None:
    path = "/share/chatbot/app-code?input=a%26b&input=c+%20d#message-1"
    result = resolve_web_login_redirect(
        f"https://apps.example.com{path}" if absolute else path,
        app_web_url="https://apps.example.com/share",
        console_web_url="https://console.example.com",
    )
    assert result == f"https://apps.example.com{path}"


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
