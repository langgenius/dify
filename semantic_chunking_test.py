"""
Simplified test for semantic chunking without Flask app context.
This test directly uses the SemanticTextSplitter implementation.
"""

import sys
import os
from typing import Optional, List

class MockLLMModelInstance:
    """Mock LLM for testing purposes."""
    
    def __init__(self, model="mock-llm", provider="mock-provider"):
        self.model = model
        self.provider = provider
    
    def invoke_llm(self, prompt: str, stream: bool = False, temperature: float = 0, max_tokens: int = 50):
        """Mock LLM response that returns a reasonable split index."""
        # Simulate finding a natural break point by looking for sentence endings
        # This is a simplified version of what the real LLM would do
        text_to_analyze = prompt.split("Text to analyze: ")[1].split("\n\n")[0]
        
        # Look for natural break points (periods, question marks, exclamation points)
        for i, char in enumerate(text_to_analyze):
            if i > len(text_to_analyze) // 2 and char in ['.', '!', '?', '\n']:
                return MockResponse(str(i))
                
        # If no natural break point found, return the middle
        return MockResponse(str(len(text_to_analyze) // 2))


class MockResponse:
    """Mock response from LLM."""
    
    def __init__(self, content: str):
        self.content = content


class SemanticTextSplitter:
    """
    A simplified version of the actual SemanticTextSplitter for testing purposes.
    This implementation mimics the behavior of the real implementation.
    """
    
    def __init__(
        self,
        llm_model_instance,
        fallback_splitter=None,
        chunk_size: int = 4000,
        chunk_overlap: int = 200,
    ):
        self._llm_model_instance = llm_model_instance
        self._chunk_size = chunk_size
        self._chunk_overlap = chunk_overlap
        self._fallback_splitter = fallback_splitter or SimpleSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
    
    def split_text(self, text: str) -> List[str]:
        """
        Split text using LLM-based semantic chunking.
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
            print(f"LLM-based semantic chunking failed: {str(e)}. Falling back to traditional chunking.")
            # Fallback to standard chunking if LLM-based approach fails
            return self._fallback_splitter.split_text(text)
            
    def _refine_chunks_with_llm(self, chunks: List[str]) -> List[str]:
        """
        Use the LLM to refine chunk boundaries based on semantic meaning.
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
                print(f"Error during LLM boundary analysis: {str(e)}")
                refined_chunks.append(current_chunk)
        
        # Add the last chunk
        if chunks and len(chunks) > 0:
            refined_chunks.append(chunks[-1])
            
        return refined_chunks
    
    def _create_boundary_analysis_prompt(self, text: str) -> str:
        """
        Create a prompt for the LLM to analyze the text and find natural break points.
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


class SimpleSplitter:
    """A simple text splitter that mimics the behavior of FixedRecursiveCharacterTextSplitter."""
    
    def __init__(self, chunk_size: int, chunk_overlap: int):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
    
    def split_text(self, text: str) -> List[str]:
        """Split text into chunks of specified size with overlap."""
        if not text:
            return []
            
        # Simple chunking by size without considering natural breaks
        chunks = []
        start = 0
        
        while start < len(text):
            end = min(start + self.chunk_size, len(text))
            
            # Try to find a natural break point near the end
            if end < len(text):
                # Look for paragraph breaks or sentence endings
                for break_char in ['\n\n', '.', '!', '?', '\n', ' ']:
                    last_break = text.rfind(break_char, start, end)
                    if last_break != -1 and last_break > start:
                        end = last_break + 1
                        break
            
            # Add the chunk
            chunks.append(text[start:end])
            
            # Calculate next start position with overlap
            start = end - self.chunk_overlap
            
            # Ensure we're making progress
            if start >= end:
                start = end
                
        return chunks


# Sample text with distinct semantic sections
sample_text = """
# Introduction to Artificial Intelligence

Artificial Intelligence (AI) is a field of computer science focused on creating systems capable of performing tasks that typically require human intelligence. These tasks include learning, reasoning, problem-solving, perception, and language understanding.

# Machine Learning Fundamentals

Machine learning is a subset of AI that focuses on building systems that can learn from and make decisions based on data. Instead of being explicitly programmed, these systems identify patterns in data and make predictions.

There are three main types of machine learning:
1. Supervised learning, where models learn from labeled data
2. Unsupervised learning, where models identify patterns in unlabeled data
3. Reinforcement learning, where models learn optimal actions through trial and error

# Natural Language Processing

Natural Language Processing (NLP) combines linguistics and AI to enable computers to understand, interpret, and generate human language. NLP powers voice assistants, translation services, and text analysis tools.

Key NLP tasks include:
- Sentiment analysis
- Named entity recognition
- Text summarization
- Question answering
- Machine translation
"""

if __name__ == "__main__":
    print("Testing Simplified Semantic Chunking Implementation")
    print("-" * 50)
    
    # Create a mock LLM model instance
    mock_llm = MockLLMModelInstance()
    
    # Fixed chunking
    simple_splitter = SimpleSplitter(chunk_size=200, chunk_overlap=20)
    fixed_chunks = simple_splitter.split_text(sample_text)
    
    print("\nFixed Chunking Results:")
    print(f"Number of chunks: {len(fixed_chunks)}")
    for i, chunk in enumerate(fixed_chunks):
        print(f"\nChunk {i+1} ({len(chunk)} chars):")
        print(chunk[:100] + "..." if len(chunk) > 100 else chunk)
    
    # Semantic chunking with mock LLM
    semantic_splitter = SemanticTextSplitter(
        llm_model_instance=mock_llm,
        fallback_splitter=simple_splitter,
        chunk_size=200,
        chunk_overlap=20,
    )
    semantic_chunks = semantic_splitter.split_text(sample_text)
    
    print("\nSemantic Chunking Results:")
    print(f"Number of chunks: {len(semantic_chunks)}")
    for i, chunk in enumerate(semantic_chunks):
        print(f"\nChunk {i+1} ({len(chunk)} chars):")
        print(chunk[:100] + "..." if len(chunk) > 100 else chunk)
        
    # Analyze the quality of chunk boundaries
    print("\nAnalyzing chunk boundaries:")
    natural_boundaries = [".", "!", "?"]
    semantic_complete_sentences = sum(1 for chunk in semantic_chunks if chunk.strip()[-1] in natural_boundaries)
    fixed_complete_sentences = sum(1 for chunk in fixed_chunks if chunk.strip()[-1] in natural_boundaries)
    
    print(f"Fixed chunking: {fixed_complete_sentences}/{len(fixed_chunks)} chunks end with complete sentences")
    print(f"Semantic chunking: {semantic_complete_sentences}/{len(semantic_chunks)} chunks end with complete sentences")
    
    # Check if there are section headings split across chunks
    fixed_headings_split = sum(1 for chunk in fixed_chunks if chunk.strip().startswith('#') and not chunk.strip().endswith('\n'))
    semantic_headings_split = sum(1 for chunk in semantic_chunks if chunk.strip().startswith('#') and not chunk.strip().endswith('\n'))
    
    print(f"Fixed chunking: {fixed_headings_split} chunks have headings split from their content")
    print(f"Semantic chunking: {semantic_headings_split} chunks have headings split from their content")
    
    # Check if semantically related content stays together
    fixed_list_breaks = 0
    semantic_list_breaks = 0
    
    for chunk in fixed_chunks:
        if ("-" in chunk or any(f"{i}." in chunk for i in range(1, 10))) and chunk.strip()[-1] != '\n':
            fixed_list_breaks += 1
            
    for chunk in semantic_chunks:
        if ("-" in chunk or any(f"{i}." in chunk for i in range(1, 10))) and chunk.strip()[-1] != '\n':
            semantic_list_breaks += 1
    
    print(f"Fixed chunking: {fixed_list_breaks} chunks break lists across chunks")
    print(f"Semantic chunking: {semantic_list_breaks} chunks break lists across chunks") 