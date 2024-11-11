"""Abstract interface for document clean implementations."""

from core.rag.cleaner.cleaner_base import BaseCleaner


class UnstructuredNonAsciiCharsCleaner(BaseCleaner):
    def clean(self, content) -> str:
        """clean document content."""
        from unstructured.cleaners.core import clean_non_ascii_chars

        # Returns "This text contains non-ascii characters!"
        return clean_non_ascii_chars(content)
