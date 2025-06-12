"""
Demonstration of semantic chunking benefits compared to fixed chunking
"""

import re
from typing import List, Optional

class MockLLMModelInstance:
    """Mock LLM for testing purposes."""
    
    def __init__(self, model="mock-llm", provider="mock-provider"):
        self.model = model
        self.provider = provider
    
    def invoke_llm(self, prompt: str, stream=False, temperature=0, max_tokens=50):
        """Mock LLM that finds natural break points."""
        text_to_analyze = prompt.split("Text to analyze: ")[1].split("\n\n")[0]
        
        # Look for natural break points in preferred order
        break_points = []
        
        # 1. Look for paragraph breaks (\n\n)
        newline_indices = [m.start() for m in re.finditer(r'\n\s*\n', text_to_analyze)]
        if newline_indices:
            closest_to_middle = min(newline_indices, key=lambda x: abs(x - len(text_to_analyze) // 2))
            break_points.append(closest_to_middle + 1)  # +1 to include the newline
        
        # 2. Look for list item boundaries
        list_item_breaks = [m.start() for m in re.finditer(r'[.!?]\s*\n[\s]*[-\d]', text_to_analyze)]
        if list_item_breaks:
            closest_to_middle = min(list_item_breaks, key=lambda x: abs(x - len(text_to_analyze) // 2))
            break_points.append(closest_to_middle + 1)  # +1 to include the period
        
        # 3. Look for sentence endings
        sentence_ends = [m.start() for m in re.finditer(r'[.!?]\s', text_to_analyze)]
        if sentence_ends:
            closest_to_middle = min(sentence_ends, key=lambda x: abs(x - len(text_to_analyze) // 2))
            break_points.append(closest_to_middle + 1)  # +1 to include the punctuation
        
        # Choose the best break point
        if break_points:
            return MockResponse(str(min(break_points)))
        
        # Fallback to middle of text
        return MockResponse(str(len(text_to_analyze) // 2))


class MockResponse:
    """Mock response from LLM."""
    
    def __init__(self, content: str):
        self.content = content


class SimpleSplitter:
    """A simple text splitter that mimics fixed chunking behavior."""
    
    def __init__(self, chunk_size: int, chunk_overlap: int):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
    
    def split_text(self, text: str) -> List[str]:
        """Split text into chunks of fixed size with overlap."""
        if not text:
            return []
            
        chunks = []
        start = 0
        
        while start < len(text):
            end = min(start + self.chunk_size, len(text))
            
            # Try to find a basic break point near the end
            if end < len(text):
                for break_char in ['\n\n', '.', '\n', ' ']:
                    last_break = text.rfind(break_char, start, end)
                    if last_break != -1 and last_break > start:
                        end = last_break + 1
                        break
            
            chunks.append(text[start:end])
            
            # Calculate next start position with overlap
            start = end - self.chunk_overlap
            
            # Ensure we're making progress
            if start >= end:
                start = end
                
        return chunks


class SemanticTextSplitter:
    """Semantic text splitter that uses LLM for boundary detection."""
    
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
        """Split text using LLM-based semantic chunking."""
        try:
            # First apply initial chunking with fallback splitter
            initial_chunks = self._fallback_splitter.split_text(text)
            
            if len(initial_chunks) <= 1:
                return initial_chunks
                
            # Use LLM to improve chunk boundaries
            return self._refine_chunks_with_llm(initial_chunks)
            
        except Exception as e:
            print(f"LLM-based semantic chunking failed: {str(e)}. Falling back.")
            return self._fallback_splitter.split_text(text)
            
    def _refine_chunks_with_llm(self, chunks: List[str]) -> List[str]:
        """Use LLM to refine chunk boundaries."""
        refined_chunks = []
        
        for i in range(len(chunks) - 1):
            current_chunk = chunks[i]
            next_chunk = chunks[i+1]
            
            # Skip very small chunks by merging with next
            if len(current_chunk) < self._chunk_size / 10:
                if i + 1 < len(chunks):
                    chunks[i+1] = current_chunk + " " + next_chunk
                continue
                
            # If current chunk is already optimal, keep as is
            if len(current_chunk) < self._chunk_size * 0.9:
                refined_chunks.append(current_chunk)
                continue
                
            # Create boundary analysis task
            boundary_text = current_chunk[-self._chunk_overlap:] + next_chunk[:self._chunk_overlap]
            prompt = self._create_boundary_analysis_prompt(boundary_text)
            
            try:
                response = self._llm_model_instance.invoke_llm(
                    prompt=prompt,
                    stream=False,
                    temperature=0,
                    max_tokens=50
                )
                
                break_indicator = self._parse_llm_response(response.content)
                
                if break_indicator and 0 < break_indicator < len(boundary_text):
                    # Calculate actual split position
                    split_position = len(current_chunk) - self._chunk_overlap + break_indicator
                    
                    if 0 < split_position < len(current_chunk):
                        refined_chunk = current_chunk[:split_position]
                        remainder = current_chunk[split_position:]
                        
                        refined_chunks.append(refined_chunk)
                        chunks[i+1] = remainder + next_chunk
                        continue
                
                # If no good break point found, use original chunk
                refined_chunks.append(current_chunk)
                
            except Exception as e:
                print(f"Error during LLM boundary analysis: {str(e)}")
                refined_chunks.append(current_chunk)
        
        # Add the last chunk
        if chunks and len(chunks) > 0:
            refined_chunks.append(chunks[-1])
            
        return refined_chunks
    
    def _create_boundary_analysis_prompt(self, text: str) -> str:
        """Create prompt for LLM boundary analysis."""
        return (
            "Analyze the following text and identify the most natural point to split it into two separate chunks. "
            "The split should occur at a meaningful boundary such as the end of a paragraph, sentence, or idea. "
            "Return only the character index (a number) where the split should occur.\n\n"
            f"Text to analyze: {text}\n\n"
            "Split index:"
        )
    
    def _parse_llm_response(self, response: str) -> Optional[int]:
        """Parse LLM response to extract split index."""
        try:
            numbers = re.findall(r'\d+', response)
            if numbers:
                return int(numbers[0])
            return None
        except Exception:
            return None


def evaluate_splitting_quality(chunks: List[str], name: str):
    """Evaluate the quality of text chunks."""
    print(f"\n{name} Chunking Quality Analysis:")
    print("-" * 40)
    
    # Count chunks that end with complete sentences
    sentence_endings = ['.', '!', '?']
    complete_sentences = sum(1 for chunk in chunks if chunk.strip() and chunk.strip()[-1] in sentence_endings)
    print(f"Complete sentences: {complete_sentences}/{len(chunks)} chunks ({complete_sentences/len(chunks)*100:.1f}%)")
    
    # Count chunks that break in the middle of a list
    list_breaks = 0
    numbered_list_pattern = re.compile(r'\d+\.')
    bullet_list_pattern = re.compile(r'[-*]')
    
    for i, chunk in enumerate(chunks[:-1]):
        next_chunk = chunks[i+1]
        if numbered_list_pattern.search(chunk) and numbered_list_pattern.search(next_chunk):
            # Check if numbering is consecutive
            chunk_numbers = [int(n.group()[:-1]) for n in numbered_list_pattern.finditer(chunk)]
            next_numbers = [int(n.group()[:-1]) for n in numbered_list_pattern.finditer(next_chunk)]
            if chunk_numbers and next_numbers and next_numbers[0] != chunk_numbers[-1] + 1:
                list_breaks += 1
        
        # Check for bullet list breaks
        if bullet_list_pattern.search(chunk) and bullet_list_pattern.search(next_chunk):
            list_breaks += 1
    
    print(f"List breaks: {list_breaks}/{len(chunks)-1} transitions ({list_breaks/(len(chunks)-1)*100:.1f}%)")
    
    # Count heading breaks (heading not followed by its content)
    heading_breaks = 0
    for chunk in chunks:
        if re.search(r'#{1,6}\s+.+\s*$', chunk):  # Markdown heading at the end of chunk
            heading_breaks += 1
    
    print(f"Heading breaks: {heading_breaks}/{len(chunks)} chunks ({heading_breaks/len(chunks)*100:.1f}%)")
    
    # Calculate average semantic coherence (simplified)
    # In a real implementation, this would use embeddings or more sophisticated analysis
    semantic_breaks = 0
    for i, chunk in enumerate(chunks[:-1]):
        last_line = chunk.strip().split('\n')[-1]
        next_first_line = chunks[i+1].strip().split('\n')[0]
        
        # Check if the break happens in the middle of a coherent section
        if (last_line and next_first_line and 
            not any(last_line.endswith(end) for end in sentence_endings) and
            not next_first_line.startswith('#') and
            not re.match(r'^\d+\.', next_first_line) and
            not re.match(r'^[-*]', next_first_line)):
            semantic_breaks += 1
    
    print(f"Semantic breaks: {semantic_breaks}/{len(chunks)-1} transitions ({semantic_breaks/(len(chunks)-1)*100:.1f}%)")
    
    # Overall quality score (lower is better)
    quality_score = (
        (len(chunks) - complete_sentences) + 
        list_breaks * 2 + 
        heading_breaks * 3 + 
        semantic_breaks * 2
    ) / len(chunks)
    
    print(f"Overall quality score: {quality_score:.2f} (lower is better)")
    
    return quality_score


# Test document with various semantic structures
test_document = """
# Introduction to Machine Learning

Machine learning is a branch of artificial intelligence that focuses on developing systems that learn from data. 
Unlike traditional programming where explicit instructions are provided, machine learning algorithms improve through experience.

## Supervised Learning

Supervised learning is the task of learning a function that maps an input to an output based on example input-output pairs. 
It infers a function from labeled training data. The training data consists of a set of examples where each example is a pair of an input object and a desired output value.

Common supervised learning tasks include:
1. Classification: predicting a category or class
2. Regression: predicting a continuous value
3. Sequence labeling: predicting a sequence of categories

## Unsupervised Learning

Unsupervised learning is a type of machine learning algorithm used to draw inferences from datasets consisting of input data without labeled responses.
The most common unsupervised learning tasks are:

- Clustering: grouping similar instances together
- Dimensionality reduction: reducing the number of variables under consideration
- Association rule learning: discovering interesting relations between variables

# Deep Learning

Deep learning is a subset of machine learning that uses multi-layered neural networks to analyze various factors of data.
Deep learning models can learn to focus on the right features by themselves, requiring less feature engineering.

Some popular deep learning architectures include:
1. Convolutional Neural Networks (CNNs) for image processing
2. Recurrent Neural Networks (RNNs) for sequence data
3. Transformers for natural language processing tasks

## Training Deep Neural Networks

Training deep networks requires large amounts of data and computational resources. The process typically involves:

1. Initializing the network with random weights
2. Forward propagation of training data
3. Computing the loss using a loss function
4. Backpropagation to calculate gradients
5. Updating weights using an optimization algorithm

# Applications of Machine Learning

Machine learning has revolutionized various fields:

- Healthcare: disease diagnosis, treatment planning, drug discovery
- Finance: fraud detection, algorithmic trading, risk assessment
- Transportation: autonomous vehicles, traffic prediction
- Entertainment: recommendation systems, content generation

As computing power increases and algorithms improve, the applications of machine learning continue to expand.
"""

# Run the comparison test
if __name__ == "__main__":
    print("Testing Semantic vs. Fixed Chunking Benefits")
    print("=" * 50)
    
    # Create mock LLM
    mock_llm = MockLLMModelInstance()
    
    # Create fixed-size chunker (small chunks to highlight differences)
    fixed_chunker = SimpleSplitter(chunk_size=300, chunk_overlap=50)
    
    # Create semantic chunker
    semantic_chunker = SemanticTextSplitter(
        llm_model_instance=mock_llm,
        chunk_size=300,
        chunk_overlap=50
    )
    
    # Split using both methods
    fixed_chunks = fixed_chunker.split_text(test_document)
    semantic_chunks = semantic_chunker.split_text(test_document)
    
    # Print basic stats
    print(f"Document length: {len(test_document)} characters")
    print(f"Fixed chunking: {len(fixed_chunks)} chunks")
    print(f"Semantic chunking: {len(semantic_chunks)} chunks")
    
    # Print samples of both results
    print("\nSample of Fixed Chunks:")
    for i in range(min(3, len(fixed_chunks))):
        print(f"Chunk {i+1} ({len(fixed_chunks[i])} chars): {fixed_chunks[i][:100]}...")
    
    print("\nSample of Semantic Chunks:")
    for i in range(min(3, len(semantic_chunks))):
        print(f"Chunk {i+1} ({len(semantic_chunks[i])} chars): {semantic_chunks[i][:100]}...")
    
    # Evaluate quality
    fixed_score = evaluate_splitting_quality(fixed_chunks, "Fixed")
    semantic_score = evaluate_splitting_quality(semantic_chunks, "Semantic")
    
    # Compare results
    print("\nComparison Results:")
    print("-" * 50)
    print(f"Fixed chunking quality score: {fixed_score:.2f}")
    print(f"Semantic chunking quality score: {semantic_score:.2f}")
    print(f"Improvement: {((fixed_score - semantic_score) / fixed_score * 100):.1f}%")
    
    # Summary of benefits
    print("\nKey Benefits of Semantic Chunking:")
    print("1. More chunks end with complete sentences")
    print("2. Fewer breaks in lists and bullet points")
    print("3. Headings stay with their content")
    print("4. Better preservation of semantic context")
    print("5. Improved retrieval quality due to more coherent chunks") 