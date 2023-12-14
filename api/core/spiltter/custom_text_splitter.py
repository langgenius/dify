from typing import List, Any
from langchain.text_splitter import RecursiveCharacterTextSplitter,SpacyTextSplitter

class CustomTextSplitter(RecursiveCharacterTextSplitter):
   
    def __init__(
            self,
            keep_separator: bool = True,
            **kwargs: Any,
    ) -> None:
        """Create a new TextSplitter."""
        super().__init__(keep_separator=keep_separator, **kwargs)

        try:
            self.text_splitter = SpacyTextSplitter(
                pipeline="zh_core_web_sm",
                chunk_size=self._chunk_size,
                chunk_overlap=self._chunk_overlap,
            )
        except Exception:
            self.text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=self._chunk_size, chunk_overlap=self._chunk_overlap
            )
        

    def _split_text(self, text: str, separators: List[str]) -> List[str]:
        """Split incoming text and return chunks."""
        return self.text_splitter._split_text(text,separators)
