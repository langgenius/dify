from __future__ import annotations

import logging
from typing import Any, Optional, List

from core.model_manager import ModelManager, ModelInstance
from core.rag.models.document import Document
from core.rag.splitter.text_splitter import TextSplitter
from core.model_runtime.entities.model_entities import ModelType
from core.rag.splitter.fixed_text_splitter import FixedRecursiveCharacterTextSplitter

logger = logging.getLogger(__name__)

class SemanticTextSplitter(TextSplitter):
    """
    A text splitter that uses an LLM to identify semantic boundaries in text.
    
    This splitter first uses a traditional method as a fallback, then refines using LLM-based
    semantic analysis to ensure chunk boundaries align with natural semantic breaks.
    """

    def __init__(
        self,
        llm_model_instance: ModelInstance,
        fallback_splitter: Optional[TextSplitter] = None,
        chunk_size: int = 4000,
        chunk_overlap: int = 200,
        **kwargs: Any,
    ) -> None:
        """
        Initialize the semantic text splitter.
        
        Args:
            llm_model_instance: The LLM model instance to use for semantic chunking
            fallback_splitter: A fallback splitter to use if the LLM chunking fails
            chunk_size: Maximum size of chunks to return
            chunk_overlap: Overlap in characters between chunks
            **kwargs: Additional arguments to pass to the TextSplitter base class
        """
        super().__init__(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            **kwargs
        )
        self._llm_model_instance = llm_model_instance
        self._fallback_splitter = fallback_splitter or FixedRecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )

    def split_text(self, text: str) -> list[str]:
        """
        Split text using LLM-based semantic chunking.
        
        This method first applies a basic chunking method, then refines the chunk
        boundaries using the LLM to identify more natural semantic breaks.
        
        Args:
            text: The text to split
            
        Returns:
            A list of text chunks with semantic coherence
        """
        try:
            # First apply initial chunking with our fallback splitter
            initial_chunks = self._fallback_splitter.split_text(text)
            
            # If the text is short enough, return as a single chunk
            if len(initial_chunks) <= 1:
                return initial_chunks
                
            # Use LLM to improve chunk boundaries for semantic coherence
            return self._refine_chunks_with_llm(initial_chunks)
            
        except Exception as e:
            logger.warning(f"LLM-based semantic chunking failed: {str(e)}. Falling back to traditional chunking.")
            # Fallback to standard chunking if LLM-based approach fails
            return self._fallback_splitter.split_text(text)
            
    def _refine_chunks_with_llm(self, chunks: List[str]) -> List[str]:
        """
        Use the LLM to refine chunk boundaries based on semantic meaning.
        
        Args:
            chunks: Initial text chunks to refine
            
        Returns:
            Refined chunks with improved semantic coherence
        """
        refined_chunks = []
        
        # Process chunks in pairs to determine better break points
        for i in range(len(chunks) - 1):
            current_chunk = chunks[i]
            next_chunk = chunks[i+1]
            
            # Skip very small chunks by merging them with the next one
            if len(current_chunk) < self._chunk_size / 10:
                if i + 1 < len(chunks):
                    chunks[i+1] = current_chunk + " " + next_chunk
                continue
                
            # If the current chunk is already optimal, keep it as is
            if len(current_chunk) < self._chunk_size * 0.9:
                refined_chunks.append(current_chunk)
                continue
                
            # Create a boundary analysis task for the LLM to find a natural break point
            # between the current chunk and the next
            boundary_text = current_chunk[-self._chunk_overlap:] + next_chunk[:self._chunk_overlap]
            
            prompt = self._create_boundary_analysis_prompt(boundary_text)
            
            # Use the LLM to find a natural break point
            try:
                response = self._llm_model_instance.invoke_llm(
                    prompt=prompt,
                    stream=False,
                    temperature=0,
                    max_tokens=50
                )
                
                break_indicator = self._parse_llm_response(response.content)
                
                # Apply the break point to create a more natural chunk division
                if break_indicator and 0 < break_indicator < len(boundary_text):
                    # Calculate the actual split position in the current chunk
                    split_position = len(current_chunk) - self._chunk_overlap + break_indicator
                    
                    # Only apply the split if it makes sense
                    if 0 < split_position < len(current_chunk):
                        refined_chunk = current_chunk[:split_position]
                        remainder = current_chunk[split_position:]
                        
                        # Add the refined chunk and combine the remainder with the next chunk
                        refined_chunks.append(refined_chunk)
                        chunks[i+1] = remainder + next_chunk
                        continue
                
                # If no good break point was found, use the original chunk
                refined_chunks.append(current_chunk)
                
            except Exception as e:
                logger.warning(f"Error during LLM boundary analysis: {str(e)}")
                refined_chunks.append(current_chunk)
        
        # Add the last chunk
        if chunks and len(chunks) > 0:
            refined_chunks.append(chunks[-1])
            
        return refined_chunks
    
    def _create_boundary_analysis_prompt(self, text: str) -> str:
        """
        Create a prompt for the LLM to analyze the text and find natural break points.
        
        Args:
            text: The text around the chunk boundary to analyze
            
        Returns:
            A prompt for the LLM
        """
        return (
            "Analyze the following text and identify the most natural point to split it into two separate chunks. "
            "The split should occur at a meaningful boundary such as the end of a paragraph, sentence, or idea. "
            "Return only the character index (a number) where the split should occur.\n\n"
            f"Text to analyze: {text}\n\n"
            "Split index:"
        )
    
    def _parse_llm_response(self, response: str) -> Optional[int]:
        """
        Parse the LLM's response to extract the split index.
        
        Args:
            response: The LLM's response containing the split index
            
        Returns:
            The index at which to split the text, or None if no valid index was found
        """
        try:
            # Extract the first number from the response
            import re
            numbers = re.findall(r'\d+', response)
            if numbers:
                return int(numbers[0])
            return None
        except Exception:
            return None
    
    def split_documents(self, documents: list[Document]) -> list[Document]:
        """Split documents using semantic chunking."""
        return super().split_documents(documents)

    @classmethod
    def from_llm(
        cls,
        llm_model_instance: Optional[ModelInstance] = None,
        chunk_size: int = 4000,
        chunk_overlap: int = 200,
        **kwargs: Any
    ) -> SemanticTextSplitter:
        """
        Create a SemanticTextSplitter using the specified LLM.
        
        Args:
            llm_model_instance: The LLM model instance to use
            chunk_size: Maximum size of chunks to return
            chunk_overlap: Overlap in characters between chunks
            **kwargs: Additional arguments to pass to the TextSplitter
            
        Returns:
            A configured SemanticTextSplitter
        """
        # If no model instance is provided, try to get a default one
        if not llm_model_instance:
            try:
                model_manager = ModelManager()
                llm_model_instance = model_manager.get_default_model_instance(ModelType.LLM)
            except Exception as e:
                logger.warning(f"Failed to get default LLM model: {str(e)}. Using fallback splitter.")
                return FixedRecursiveCharacterTextSplitter(
                    chunk_size=chunk_size,
                    chunk_overlap=chunk_overlap,
                    **kwargs
                )
                
        # Create fallback splitter
        fallback_splitter = FixedRecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            **kwargs
        )
        
        return cls(
            llm_model_instance=llm_model_instance,
            fallback_splitter=fallback_splitter,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            **kwargs
        ) 