import pytest

from core.rag.extractor.extractor_base import BaseExtractor


class _CallsBaseExtractor(BaseExtractor):
    def extract(self) -> object:
        """Given the declared arguments, call the base stub and propagate NotImplementedError."""
        return BaseExtractor.extract(self)


class _ConcreteExtractor(BaseExtractor):
    def extract(self) -> list[str]:
        return ["ok"]


class TestBaseExtractor:
    def test_extract_default_raises_not_implemented(self) -> None:
        extractor = _CallsBaseExtractor()

        with pytest.raises(NotImplementedError):
            extractor.extract()

    def test_concrete_extractor_can_override(self) -> None:
        extractor = _ConcreteExtractor()

        assert extractor.extract() == ["ok"]
