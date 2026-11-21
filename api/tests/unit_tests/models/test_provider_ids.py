from werkzeug.exceptions import NotFound

import pytest

from models.provider_ids import GenericProviderID, ToolProviderID


class TestGenericProviderIDTrailingNewline:
    """A trailing newline must not slip through the `^...$` checks.

    In Python `$` also matches just before a trailing newline, so
    `re.match(r"^...$", value)` accepted identifiers ending in "\\n" and
    propagated the newline into the parsed segments. See issue #46875.
    """

    def test_rejects_trailing_newline_in_full_id(self) -> None:
        with pytest.raises(ValueError):
            GenericProviderID("langgenius/openai\n")

    def test_rejects_trailing_newline_in_bare_org(self) -> None:
        with pytest.raises(ValueError):
            GenericProviderID("langgenius\n")

    def test_rejects_leading_newline(self) -> None:
        with pytest.raises(ValueError):
            GenericProviderID("\nlanggenius/openai")

    def test_still_accepts_normal_ids(self) -> None:
        pid = GenericProviderID("langgenius/openai/openai")
        assert pid.organization == "langgenius"
        assert pid.plugin_name == "openai"
        assert pid.provider_name == "openai"

        tool = ToolProviderID("langgenius/jina/jina")
        assert tool.plugin_name == "jina_tool"

    def test_missing_id_still_raises_not_found(self) -> None:
        with pytest.raises(NotFound):
            GenericProviderID("")
