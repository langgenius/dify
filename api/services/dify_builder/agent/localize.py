"""Detect the Builder reply language; fixed copy is localized by Web i18n."""

import logging
import re
from collections.abc import Callable

from services.dify_builder import trace_diagnostics
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
    def __init__(self, model_provider: Callable[[], object | None], *, prior_language: str = "") -> None:
        self._model_provider = model_provider
        self._prior_language = prior_language if _LANG_CODE_RE.fullmatch(prior_language) else ""

    def _fallback(self, text: str) -> str:
        """Use clear script evidence, then the persisted conversation locale.

        This is a presentation fallback, not a model, resource or risk decision.
        Short/ambiguous acknowledgements must not reset the conversation locale.
        """
        trace_diagnostics.report("deterministic_fallback", fallback_used=True)
        # An explicit English request can switch away from the prior locale
        # even when the language-detection provider is unavailable.
        if re.search(r"\b(?:in|use|speak|reply in|respond in) English\b", text, re.IGNORECASE):
            return "en"
        if re.search(r"[\u3040-\u30ff]", text):
            return "ja"
        if re.search(r"[\uac00-\ud7af]", text):
            return "ko"
        if re.search(r"[\u4e00-\u9fff]", text):
            return self._prior_language if self._prior_language.startswith("zh") else "zh-Hans"
        return self._prior_language or "en"

    def detect_language(self, text: str) -> str:
        if not text or not text.strip():
            return "en"
        try:
            model = self._model_provider()
            if model is None:
                return self._fallback(text)
            raw = llm.invoke_text(model, system=_DETECT_SYSTEM, user=text[:2000]).strip()
        except Exception:
            logger.exception("dify_builder: language detection failed; using conversation fallback")
            return self._fallback(text)
        # Reject anything that isn't a single short, code-shaped token: the model
        # disobeying "reply with ONLY the code" (e.g. "The language is Japanese.")
        # must use the conversation fallback instead of becoming a language tag.
        if not raw or re.search(r"\s", raw) or len(raw) > 35:
            return self._fallback(text)
        code = raw.strip('."')
        if not code or not _LANG_CODE_RE.match(code):
            return self._fallback(text)
        return code
