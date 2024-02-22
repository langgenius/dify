"""Abstract interface for document clean implementations."""
from core.rag.cleaner.cleaner_base import BaseCleaner


class UnstructuredNonAsciiCharsCleaner(BaseCleaner):

    def clean(self, content) -> str:
        """clean document content."""
        from unstructured.cleaners.core import clean_extra_whitespace

        # Returns "ITEM 1A: RISK FACTORS"
        return clean_extra_whitespace(content)
