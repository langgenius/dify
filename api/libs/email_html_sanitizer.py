"""
Email HTML sanitization helpers for outbound mail.

Sanitization runs after template rendering and placeholder substitution to ensure
untrusted HTML is filtered before delivery.
"""

from __future__ import annotations

from typing import Final

import nh3

from configs import dify_config
from configs.feature import MailHtmlSanitizerProfile

_STRICT_TAGS: Final[set[str]] = {
    "a",
    "blockquote",
    "br",
    "code",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "hr",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "span",
    "strong",
    "u",
    "ul",
}

_STRICT_ATTRIBUTES: Final[dict[str, set[str]]] = {
    "a": {"href", "target", "title"},
    "img": {"alt", "height", "src", "title", "width"},
}

_STRICT_URL_SCHEMES: Final[set[str]] = {"mailto", "cid"}
_BALANCED_URL_SCHEMES: Final[set[str]] = {"http", "https", "mailto", "cid"}

_BALANCED_TAGS: Final[set[str]] = _STRICT_TAGS | {"table", "tbody", "td", "th", "thead", "tr"}

_BALANCED_ATTRIBUTES: Final[dict[str, set[str]]] = {
    **_STRICT_ATTRIBUTES,
    "table": {"align"},
    "td": {"align", "colspan", "rowspan", "valign"},
    "th": {"align", "colspan", "rowspan", "valign"},
    "*": {"style"},
}

_BALANCED_STYLE_PROPERTIES: Final[set[str]] = {
    "background-color",
    "border",
    "color",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "line-height",
    "margin",
    "padding",
    "text-align",
    "text-decoration",
}


def _build_cleaner(profile: MailHtmlSanitizerProfile) -> nh3.Cleaner:
    if profile == MailHtmlSanitizerProfile.STRICT:
        return nh3.Cleaner(
            tags=_STRICT_TAGS,
            attributes=_STRICT_ATTRIBUTES,
            url_schemes=_STRICT_URL_SCHEMES,
            strip_comments=True,
        )
    if profile == MailHtmlSanitizerProfile.BALANCED:
        return nh3.Cleaner(
            tags=_BALANCED_TAGS,
            attributes=_BALANCED_ATTRIBUTES,
            url_schemes=_BALANCED_URL_SCHEMES,
            strip_comments=True,
            filter_style_properties=_BALANCED_STYLE_PROPERTIES,
        )
    raise ValueError(f"Unsupported mail HTML sanitizer profile: {profile}")


_CLEANERS: Final[dict[MailHtmlSanitizerProfile, nh3.Cleaner]] = {
    MailHtmlSanitizerProfile.STRICT: _build_cleaner(MailHtmlSanitizerProfile.STRICT),
    MailHtmlSanitizerProfile.BALANCED: _build_cleaner(MailHtmlSanitizerProfile.BALANCED),
}


def sanitize_email_html(html: str, *, profile: MailHtmlSanitizerProfile | None = None) -> str:
    effective_profile = profile or dify_config.MAIL_HTML_SANITIZER_PROFILE
    if effective_profile == MailHtmlSanitizerProfile.FREE:
        return html
    cleaner = _CLEANERS.get(effective_profile)
    if cleaner is None:
        raise ValueError(f"Unsupported mail HTML sanitizer profile: {effective_profile}")
    return cleaner.clean(html)


def sanitize_email_subject(subject: str) -> str:
    return "".join(ch for ch in subject if ch == "\t" or (ord(ch) >= 32 and ord(ch) != 127))
