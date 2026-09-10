"""M2: localize the Dify Builder engine's static strings into the user's language.

Runs in the service layer (may call the LLM) and is injected into the pure
engine as Env callbacks. Value-matches item strings against the static-string
catalog (core.dify_builder.strings); LLM-generated prose (already localized by
M1) never matches and is passed through. Translations are cached per
(source, language) so a language's finite vocabulary is translated once.
"""

import json
import logging
import re
from collections.abc import Callable

from core.dify_builder import strings
from core.dify_builder.models import ConversationItem
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

# (source_string, language) -> translation, for the fixed static-string catalog
# (core.dify_builder.strings). Module-level and shared across Localizer
# instances/tenants/sessions: entries are catalog strings translated into a
# given target language, independent of any tenant or session state, so a
# language's finite vocabulary really is translated once process-wide rather
# than once per advance-task invocation (a fresh Localizer is constructed per
# invocation). Plain dict is fine under gevent/GIL: a set is atomic, and a
# concurrent duplicate translation of the same key is harmless and idempotent
# -- no lock needed.
_TRANSLATION_CACHE: dict[tuple[str, str], str] = {}


class Localizer:
    def __init__(self, model_provider: Callable[[], object | None]) -> None:
        self._model_provider = model_provider

    # -- detection ----------------------------------------------------------
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

    # -- localization -------------------------------------------------------
    def localize_items(self, items: list[ConversationItem], language: str) -> list[ConversationItem]:
        if not language or language == "en":
            return items
        # 1) collect the source strings that need translation across all items
        needed: set[str] = set()
        for item in items:
            self._collect(item.payload, language, needed)
        # 2) batch-translate the cache misses in one call, populate the cache
        self._fill_cache(sorted(needed), language)
        # 3) apply
        for item in items:
            item.payload = self._apply(item.payload, language)
        return items

    def _collect(self, value, language: str, needed: set[str]) -> None:
        if isinstance(value, str):
            src = self._source_to_translate(value)
            if src is not None and (src, language) not in _TRANSLATION_CACHE:
                needed.add(src)
        elif isinstance(value, dict):
            for v in value.values():
                self._collect(v, language, needed)
        elif isinstance(value, list):
            for v in value:
                self._collect(v, language, needed)

    def _apply(self, value, language: str):
        if isinstance(value, str):
            return self._translate_value(value, language)
        if isinstance(value, dict):
            return {k: self._apply(v, language) for k, v in value.items()}
        if isinstance(value, list):
            return [self._apply(v, language) for v in value]
        return value

    def _source_to_translate(self, value: str) -> str | None:
        """The catalog source string that would be translated for `value`, or None.
        Plain catalog hit -> the value itself; template hit -> the template form."""
        if value in strings.PLAIN:
            return value
        m = strings.match_template(value)
        if m is not None:
            return m[0].template
        return None

    def _translate_value(self, value: str, language: str) -> str:
        if value in strings.PLAIN:
            return _TRANSLATION_CACHE.get((value, language), value)
        m = strings.match_template(value)
        if m is not None:
            tpl, groups = m
            translated_tpl = _TRANSLATION_CACHE.get((tpl.template, language), tpl.template)
            try:
                return translated_tpl.format(**groups)
            except Exception:
                return value  # translated template dropped a placeholder -> keep original
        return value

    def _fill_cache(self, sources: list[str], language: str) -> None:
        misses = [s for s in sources if (s, language) not in _TRANSLATION_CACHE]
        if not misses:
            return
        try:
            model = self._model_provider()
        except Exception:
            logger.exception("dify_builder: model_provider failed during translation; leaving strings in English")
            return
        if model is None:
            return
        system = (
            f"You are a translation engine. Translate each string into the language "
            f"with BCP-47 code {language}. Preserve any {{placeholder}} tokens EXACTLY. "
            "Do not translate proper nouns or code. Reply with ONLY a JSON object mapping "
            "each original string to its translation."
        )
        user = json.dumps({"strings": misses}, ensure_ascii=False)
        try:
            table = llm.invoke_json(model, system=system, user=user)
        except Exception:
            logger.exception("dify_builder: batch translation failed; leaving strings in English")
            return
        for src in misses:
            out = table.get(src)
            _TRANSLATION_CACHE[(src, language)] = out if isinstance(out, str) and out else src
