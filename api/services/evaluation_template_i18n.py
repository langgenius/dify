"""Localized copy bundled with API-generated evaluation XLSX templates."""

import json
from functools import cache
from pathlib import Path
from typing import TypedDict, cast

from constants.languages import get_valid_language


class EvaluationTemplateCopy(TypedDict):
    index: str
    input: str
    expectedOutput: str
    retrievalExpectedOutput: str
    successCriteria: str
    expectedToolCalls: str
    notice: str


@cache
def _translations() -> dict[str, EvaluationTemplateCopy]:
    """Load the committed locale bundle once without depending on Web files at runtime."""
    path = Path(__file__).with_name("evaluation_template_translations.json")
    return cast("dict[str, EvaluationTemplateCopy]", json.loads(path.read_text(encoding="utf-8")))


def get_evaluation_template_copy(language: str | None) -> EvaluationTemplateCopy:
    """Return copy for a supported system language, otherwise English."""
    translations = _translations()
    return translations.get(get_valid_language(language), translations["en-US"])
