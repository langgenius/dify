"""Localized copy bundled with API-generated evaluation XLSX templates."""

from functools import cache
from pathlib import Path
from typing import TypedDict

from pydantic import TypeAdapter

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
    """Load the committed locale bundle once without depending on Web files at runtime.

    Preconditions: the bundled JSON file exists and contains language-to-copy mappings.
    Postconditions: return validated copy for each language without changing the bundle;
    invalid JSON or field types raise a validation error.
    """
    path = Path(__file__).with_name("evaluation_template_translations.json")
    return TypeAdapter(dict[str, EvaluationTemplateCopy]).validate_json(path.read_bytes())


def get_evaluation_template_copy(language: str | None) -> EvaluationTemplateCopy:
    """Return copy for a supported system language, otherwise English."""
    translations = _translations()
    return translations.get(get_valid_language(language), translations["en-US"])
