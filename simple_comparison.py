"""
Simple comparison of fixed vs semantic chunking on a small text snippet
"""

# Sample text with clear semantic boundaries
sample_text = """
# Introduction

This is the introduction paragraph that discusses the topic in general terms. 
It should be kept together as a semantic unit. The introduction serves to set up the topic.

# First Main Point

This section covers the first main point with some supporting details.
- Point A with some explanation
- Point B with more details
- Point C concluding the list

# Second Main Point

The second main point builds on the first and adds new information.
It contains important context that should be kept together.
"""

# Fixed chunking (simplified)
def fixed_chunking(text, chunk_size=150):
    """Split text into fixed-size chunks."""
    chunks = []
    start = 0
    
    while start < len(text):
        end = min(start + chunk_size, len(text))
        
        # Try to find a natural break point near the end
        if end < len(text):
            # Look for paragraph breaks or sentence endings
            for break_char in ["\n\n", ".", "\n", " "]:
                last_break = text.rfind(break_char, start, end)
                if last_break != -1 and last_break > start:
                    end = last_break + 1
                    break
        
        chunks.append(text[start:end])
        start = end
    
    return chunks

# Semantic chunking (simplified mock implementation)
def semantic_chunking(text):
    """Split text into semantic chunks by heading."""
    # Simplified semantic chunking that looks for markdown headings
    import re
    
    # Split by markdown headings
    heading_pattern = re.compile(r'^#.*$', re.MULTILINE)
    chunks = []
    
    # Find all heading positions
    heading_matches = list(heading_pattern.finditer(text))
    
    if not heading_matches:
        return [text]
    
    # Process each section
    for i, match in enumerate(heading_matches):
        start = match.start()
        
        # If it's not the last heading, go until the next heading
        if i + 1 < len(heading_matches):
            end = heading_matches[i + 1].start()
        else:
            end = len(text)
        
        chunks.append(text[start:end])
    
    return chunks

# Compare the two methods
if __name__ == "__main__":
    print("Fixed Chunking vs. Semantic Chunking Comparison")
    print("=" * 50)
    
    # Get chunks
    fixed_chunks = fixed_chunking(sample_text)
    semantic_chunks = semantic_chunking(sample_text)
    
    # Display fixed chunks
    print("\nFixed Chunking Results:")
    print(f"Number of chunks: {len(fixed_chunks)}")
    for i, chunk in enumerate(fixed_chunks):
        print(f"\nChunk {i+1}:")
        print("-" * 30)
        print(chunk)
    
    # Display semantic chunks
    print("\nSemantic Chunking Results:")
    print(f"Number of chunks: {len(semantic_chunks)}")
    for i, chunk in enumerate(semantic_chunks):
        print(f"\nChunk {i+1}:")
        print("-" * 30)
        print(chunk)
    
    # Highlight key differences
    print("\nKey Observations:")
    print("1. Fixed chunking breaks text at arbitrary positions based mainly on length")
    print("2. Semantic chunking preserves logical sections (by headings in this simplified example)")
    print("3. In a real LLM-based implementation, semantic boundaries like sentence")
    print("   endings, paragraph breaks, and logical transitions would be detected") 