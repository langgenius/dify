"""
Simple test for semantic chunking boundary analysis.
"""

class MockLLMModelInstance:
    """Mock LLM for testing purposes."""
    
    def __init__(self, model="mock-llm", provider="mock-provider"):
        self.model = model
        self.provider = provider
    
    def invoke_llm(self, prompt: str, stream=False, temperature=0, max_tokens=50):
        """Mock LLM response that returns a reasonable split index."""
        print(f"LLM received prompt: {prompt[:50]}...")
        
        # Extract the text to analyze
        text_to_analyze = prompt.split("Text to analyze: ")[1].split("\n\n")[0]
        
        # Find the exact position of a period that marks the end of a sentence
        period_positions = [i for i, char in enumerate(text_to_analyze) if char == '.']
        
        if period_positions:
            # Find a period that's roughly in the middle of the text
            middle_index = len(text_to_analyze) // 2
            closest_period = min(period_positions, key=lambda x: abs(x - middle_index))
            return MockResponse(str(closest_period + 1))  # +1 to include the period
                
        # If no period found, return the middle
        return MockResponse(str(len(text_to_analyze) // 2))


class MockResponse:
    """Mock response from LLM."""
    
    def __init__(self, content: str):
        self.content = content


def create_boundary_analysis_prompt(text: str) -> str:
    """Create a prompt for boundary analysis."""
    return (
        "Analyze the following text and identify the most natural point to split it into two separate chunks. "
        "The split should occur at a meaningful boundary such as the end of a paragraph, sentence, or idea. "
        "Return only the character index (a number) where the split should occur.\n\n"
        f"Text to analyze: {text}\n\n"
        "Split index:"
    )


def parse_llm_response(response: str):
    """Parse the LLM response to get the split index."""
    try:
        # Extract the first number from the response
        import re
        numbers = re.findall(r'\d+', response)
        if numbers:
            return int(numbers[0])
        return None
    except Exception as e:
        print(f"Error parsing response: {e}")
        return None


def test_boundary_analysis():
    """Test the boundary analysis logic."""
    # Create test text with a clear semantic boundary
    test_text = "This is the first sentence that should stay together. This is the start of a new thought that should also stay together."
    
    # Create mock LLM
    mock_llm = MockLLMModelInstance()
    
    # Create boundary analysis prompt
    prompt = create_boundary_analysis_prompt(test_text)
    
    # Get mock LLM response
    response = mock_llm.invoke_llm(prompt)
    
    # Parse the response
    split_index = parse_llm_response(response.content)
    
    print(f"Recommended split index: {split_index}")
    print(f"Text before split: {test_text[:split_index]}")
    print(f"Text after split: {test_text[split_index:]}")
    
    # Check if split is at sentence boundary
    if split_index > 0:
        assert test_text[split_index-1] == ".", "Split should be at the end of a sentence"
        print("Test passed! Split occurred at a sentence boundary.")
    else:
        print("Test failed: Split index is not valid.")
        
    # Test with paragraph boundaries
    print("\nTesting with paragraph boundaries:")
    para_text = """This is paragraph one.
    It has multiple sentences.
    
    This is paragraph two.
    It should be kept separate."""
    
    # Create boundary analysis prompt
    para_prompt = create_boundary_analysis_prompt(para_text)
    
    # Get mock LLM response
    para_response = mock_llm.invoke_llm(para_prompt)
    
    # Parse the response
    para_split_index = parse_llm_response(para_response.content)
    
    print(f"Recommended paragraph split index: {para_split_index}")
    print(f"Text before split: {para_text[:para_split_index]}")
    print(f"Text after split: {para_text[para_split_index:]}")


if __name__ == "__main__":
    test_boundary_analysis() 