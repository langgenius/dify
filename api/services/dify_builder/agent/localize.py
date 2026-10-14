"""Detect the Builder reply language; fixed copy is localized by Web i18n."""

import logging
import re
from collections.abc import Callable

from services.dify_builder.agent import llm

logger = logging.getLogger(__name__)

_DETECT_SYSTEM = (
    "Identify the language of the user's text. Reply with ONLY its IETF BCP-47 "
    "code, e.g. en, zh-Hans, zh-Hant, ja, fr, es. No other text."
)

# A plausible BCP-47 language tag: a 2-3 letter primary subtag optionally
# followed by one or more hyphenated subtags (script/region/variant, e.g.
# "zh-Hans", "zh-Hant-HK"). Guards against a model that ignores "reply with
# ONLY the code" and returns a sentence instead.
_LANG_CODE_RE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$")


class LanguageDetector:
    def __init__(self, model_provider: Callable[[], object | None]) -> None:
        self._model_provider = model_provider

    def detect_language(self, text: str) -> str:
        if not text or not text.strip():
            return "en"
        try:
            model = self._model_provider()
            if model is None:
                return "en"
            raw = llm.invoke_text(model, system=_DETECT_SYSTEM, user=text[:2000]).strip()
        except Exception:
            logger.exception("dify_builder: language detection failed; defaulting to en")
            return "en"
        # Reject anything that isn't a single short, code-shaped token: the model
        # disobeying "reply with ONLY the code" (e.g. "The language is Japanese.")
        # must fall back to en rather than silently becoming the target language.
        if not raw or re.search(r"\s", raw) or len(raw) > 35:
            return "en"
        code = raw.strip('."')
        if not code or not _LANG_CODE_RE.match(code):
            return "en"
        return code
