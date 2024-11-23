"""Abstract interface for document clean implementations."""

from core.rag.cleaner.cleaner_base import BaseCleaner


class UnstructuredTranslateTextCleaner(BaseCleaner):
    def clean(self, content) -> str:
        """clean document content."""
        from unstructured.cleaners.translate import translate_text

        return translate_text(content)
