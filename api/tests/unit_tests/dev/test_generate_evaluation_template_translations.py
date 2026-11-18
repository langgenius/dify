import json
from pathlib import Path

import pytest

from constants.languages import languages
from dev import generate_evaluation_template_translations as generator


def test_template_bundle_matches_web_help_for_every_supported_language() -> None:
    """Precondition: Web locale files are present; postcondition: every API locale has matching field help."""
    translations = generator.build_translations()

    assert set(translations) == set(languages)
    for language in languages:
        web_copy = json.loads((generator.SOURCE_DIR / language / "evaluation.json").read_text(encoding="utf-8"))
        for field in generator.FIELD_HELP_KEYS:
            assert translations[language][field] == web_copy[f"batch.fieldHelp.{field}"]
    assert translations["zh-Hans"]["notice"] == "该行为示例说明请删除本行后进行上传评估。"
    assert "Delete this row" in translations["en-US"]["notice"]


def test_template_bundle_check_rejects_stale_output(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Precondition: output is isolated; postcondition: check mode accepts fresh data and rejects stale data."""
    output = tmp_path / "evaluation_template_translations.json"
    monkeypatch.setattr(generator, "OUTPUT", output)

    monkeypatch.setattr(generator.sys, "argv", ["generator"])
    generator.main()
    generated = json.loads(output.read_text(encoding="utf-8"))
    assert generated == generator.build_translations()

    monkeypatch.setattr(generator.sys, "argv", ["generator", "--check"])
    generator.main()
    output.write_text("{}\n", encoding="utf-8")
    with pytest.raises(ValueError, match="stale"):
        generator.main()


def test_template_bundle_requires_a_notice_for_every_language(monkeypatch: pytest.MonkeyPatch) -> None:
    """Precondition: one notice is absent; postcondition: generation rejects incomplete locale coverage."""
    monkeypatch.delitem(generator.NOTICE_BY_LOCALE, "zh-Hans")

    with pytest.raises(ValueError, match="cover every supported API language"):
        generator.build_translations()
