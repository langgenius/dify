"""Name an app after the goal prompt it was created from (App Builder spec, N1).

Pure stdlib, so the console create path and the Builder engine can both use it.

Extraction runs inside ``POST /apps``, so it is a clause cut rather than an
understanding of the sentence: instant and infallible. Anything needing
judgement is left to the Builder's goal-analysis pass, which has a model and the
detected reply language -- dropping an imperative lead-in is seeded for English
and Chinese only here, and a contentless prompt still yields a literal name
rather than the fallback. N3 freezes whatever name approval lands on.
"""

import re
from datetime import datetime

# Long enough to stay meaningful, short enough for a sidebar card. The spec's
# example cut ("Refund approval for ecommerce orders" -> "Refund approval for
# ecommerce") is this limit applied at the preceding word boundary.
MAX_NAME_LENGTH = 30

# Where the first clause ends; the rest is elaboration. ASCII terminators count
# only at a word break so "v1.5" and "gpt-4o-mini" survive, while CJK ones are
# unambiguous alone because CJK text puts no space after them.
_CLAUSE_BOUNDARY = re.compile(r"[—–;；\n\r]|[。！？…]|[.!?]+(?=\s|$)")

# Imperative lead-ins, dropped so the name reads as a thing rather than an
# instruction. An unlisted language keeps its lead-in until the Builder renames.
_LEAD_INS = (
    r"i\s+(?:want|need|would\s+like)\s+(?:to\s+)?",
    r"(?:can|could|would)\s+you\s+(?:please\s+)?",
    r"please\s+",
    r"help\s+me\s+(?:to\s+)?",
    r"let'?s\s+",
    r"(?:set\s+up|build|create|make|design|generate|write|add|implement)\s+(?:me\s+)?",
    r"(?:a|an|the)\s+",
    r"(?:请|帮我|帮忙|我想要|我想|我需要|我要)\s*",
    r"(?:创建|新建|搭建|生成|设计|编写|做)(?:一个|一份|一套|个)?\s*",
    r"(?:一个|一份|一套)\s*",  # the Chinese article, once a pronoun above is gone
)
_LEAD_IN_RE = re.compile(r"^(?:" + "|".join(_LEAD_INS) + r")", re.IGNORECASE)

# Lead-ins nest ("Please help me build an expense report app"); bound the peeling.
_MAX_LEAD_IN_PEELS = 6

# Any Unicode letter or ideograph. Without one there is no name to be had.
_HAS_LETTER = re.compile(r"[^\W\d_]")

# "New app" per console locale (api/constants/languages.py). The fallback fires
# when the prompt had no words, so it speaks the console's language.
_FALLBACK_STEM: dict[str, str] = {
    "en-US": "New app",
    "zh-Hans": "新应用",
    "zh-Hant": "新應用",
    "pt-BR": "Novo app",
    "es-ES": "Nueva aplicación",
    "fr-FR": "Nouvelle application",
    "de-DE": "Neue App",
    "ja-JP": "新しいアプリ",
    "ko-KR": "새 앱",
    "lo-LA": "ແອັບໃໝ່",
    "ru-RU": "Новое приложение",
    "it-IT": "Nuova app",
    "uk-UA": "Новий застосунок",
    "vi-VN": "Ứng dụng mới",
    "ro-RO": "Aplicație nouă",
    "pl-PL": "Nowa aplikacja",
    "hi-IN": "नया ऐप",
    "tr-TR": "Yeni uygulama",
    "fa-IR": "برنامه جدید",
    "sl-SI": "Nova aplikacija",
    "th-TH": "แอปใหม่",
    "id-ID": "Aplikasi baru",
    "ar-TN": "تطبيق جديد",
    "nl-NL": "Nieuwe app",
}
_DEFAULT_LANGUAGE = "en-US"

# Only the stamp's shape varies. Other locales take the English month
# abbreviation: unambiguous everywhere, and cheaper to keep right than 24 month
# tables for a name meant to be replaced.
_CJK_STAMP = frozenset({"zh-Hans", "zh-Hant", "ja-JP"})
_MONTH_ABBR = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def fallback_app_name(now: datetime, language: str = _DEFAULT_LANGUAGE) -> str:
    """The name for a prompt with nothing nameable in it: ``New app · Sep 7, 14:02``.

    ``now`` is used as given -- pass it in the account's own timezone, since the
    stamp exists to be recognised by the person who just typed.
    """
    stem = _FALLBACK_STEM.get(language, _FALLBACK_STEM[_DEFAULT_LANGUAGE])
    if language in _CJK_STAMP:
        stamp = f"{now.month}月{now.day}日 {now:%H:%M}"
    elif language == "ko-KR":
        stamp = f"{now.month}월 {now.day}일 {now:%H:%M}"
    else:
        stamp = f"{_MONTH_ABBR[now.month - 1]} {now.day}, {now:%H:%M}"
    return f"{stem} · {stamp}"


def _first_clause(prompt: str) -> str:
    return _CLAUSE_BOUNDARY.split(prompt.strip(), maxsplit=1)[0]


def _strip_lead_ins(text: str) -> str:
    for _ in range(_MAX_LEAD_IN_PEELS):
        peeled = _LEAD_IN_RE.sub("", text, count=1)
        # Stop before peeling the name away entirely ("Build me an app" -> "app").
        if peeled == text or not _HAS_LETTER.search(peeled):
            return text
        text = peeled
    return text


def _truncate(text: str) -> str:
    if len(text) <= MAX_NAME_LENGTH:
        return text
    head = text[:MAX_NAME_LENGTH]
    # Back off to the preceding word boundary when the cut landed inside a word.
    # Scripts without spaces (CJK, Thai) have none, and cutting at the character
    # is already right there.
    if not text[MAX_NAME_LENGTH].isspace() and (boundary := head.rfind(" ")) > 0:
        head = head[:boundary]
    return head.rstrip()


def derive_app_name(prompt: str, *, now: datetime, language: str = _DEFAULT_LANGUAGE) -> str:
    """Name an app after the prompt that created it. Never raises."""
    clause = re.sub(r"\s+", " ", _first_clause(prompt or "")).strip()
    candidate = _strip_lead_ins(clause)
    peeled = candidate != clause
    candidate = _truncate(candidate).strip(" ,.:;·-—–、，。")
    if not _HAS_LETTER.search(candidate):
        return fallback_app_name(now, language)
    if peeled and candidate[:1].islower():
        # Peeling "Set up an " leaves a fragment mid-sentence-case. Scripts
        # without case are unaffected.
        candidate = candidate[0].upper() + candidate[1:]
    return candidate


def normalize_proposed_name(name: str) -> str:
    """Make a model-proposed name safe to store, or "" to keep the derived one.

    The model is asked for a short title but not trusted to have produced one.
    A refinement that cannot improve on the derived name must not replace it.
    """
    candidate = re.sub(r"\s+", " ", name or "").strip().strip("\"'“”‘’「」『』")
    candidate = _truncate(candidate).strip()
    return candidate if _HAS_LETTER.search(candidate) else ""
