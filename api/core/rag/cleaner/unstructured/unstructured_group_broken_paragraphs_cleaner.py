"""Abstract interface for document clean implementations."""
from core.rag.cleaner.cleaner_base import BaseCleaner


class UnstructuredGroupBrokenParagraphsCleaner(BaseCleaner):

    def clean(self, content) -> str:
        """clean document content."""
        import re

        from unstructured.cleaners.core import group_broken_paragraphs

        para_split_re = re.compile(r"(\s*\n\s*){3}")

        return group_broken_paragraphs(content, paragraph_split=para_split_re)
