"""Abstract interface for document clean implementations."""
from core.rag.cleaner.cleaner_base import BaseCleaner


class UnstructuredNonAsciiCharsCleaner(BaseCleaner):

    def clean(self, content) -> str:
        """Replaces unicode quote characters, such as the \x91 character in a string."""

        from unstructured.cleaners.core import replace_unicode_quotes
        return replace_unicode_quotes(content)
