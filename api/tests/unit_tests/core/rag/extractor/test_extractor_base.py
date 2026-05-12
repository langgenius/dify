import pytest

from core.rag.extractor.extractor_base import BaseExtractor


class _CallsBaseExtractor(BaseExtractor):
    def extract(self):
        return super().extract()


class _ConcreteExtractor(BaseExtractor):
    def extract(self):
        return ["ok"]


class TestBaseExtractor:
    def test_extract_default_raises_not_implemented(self):
        extractor = _CallsBaseExtractor()

        with pytest.raises(NotImplementedError):
            extractor.extract()

    def test_concrete_extractor_can_override(self):
        extractor = _ConcreteExtractor()

        assert extractor.extract() == ["ok"]
