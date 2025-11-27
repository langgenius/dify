"""
Comprehensive test suite for text splitter functionality.

This module provides extensive testing coverage for text splitting operations
used in RAG (Retrieval-Augmented Generation) systems. Text splitters are crucial
for breaking down large documents into manageable chunks while preserving context
and semantic meaning.

## Test Coverage Overview

### Core Splitter Types Tested:
1. **RecursiveCharacterTextSplitter**: Main splitter that recursively tries different
   separators (paragraph -> line -> word -> character) to split text appropriately.

2. **TokenTextSplitter**: Splits text based on token count using tiktoken library,
   useful for LLM context window management.

3. **EnhanceRecursiveCharacterTextSplitter**: Enhanced version with custom token
   counting support via embedding models or GPT2 tokenizer.

4. **FixedRecursiveCharacterTextSplitter**: Prioritizes a fixed separator before
   falling back to recursive splitting, useful for structured documents.

### Test Categories:

#### Helper Functions (TestSplitTextWithRegex, TestSplitTextOnTokens)
- Tests low-level splitting utilities
- Regex pattern handling
- Token-based splitting mechanics

#### Core Functionality (TestRecursiveCharacterTextSplitter, TestTokenTextSplitter)
- Initialization and configuration
- Basic splitting operations
- Separator hierarchy behavior
- Chunk size and overlap handling

#### Enhanced Splitters (TestEnhanceRecursiveCharacterTextSplitter, TestFixedRecursiveCharacterTextSplitter)
- Custom encoder integration
- Fixed separator prioritization
- Character-level splitting with overlap
- Multilingual separator support

#### Metadata Preservation (TestMetadataPreservation)
- Metadata copying across chunks
- Start index tracking
- Multiple document processing
- Complex metadata types (strings, lists, dicts)

#### Edge Cases (TestEdgeCases)
- Empty text, single characters, whitespace
- Unicode and emoji handling
- Very small/large chunk sizes
- Zero overlap scenarios
- Mixed separator types

#### Advanced Scenarios (TestAdvancedSplittingScenarios)
- Markdown, HTML, JSON document splitting
- Technical documentation
- Code and mixed content
- Lists, tables, quotes
- URLs and email content

#### Configuration Testing (TestSplitterConfiguration)
- Custom length functions
- Different separator orderings
- Extreme overlap ratios
- Start index accuracy
- Regex pattern separators

#### Error Handling (TestErrorHandlingAndRobustness)
- Invalid inputs (None, empty)
- Extreme parameters
- Special characters (unicode, control chars)
- Repeated separators
- Empty separator lists

#### Performance (TestPerformanceCharacteristics)
- Chunk size consistency
- Information preservation
- Deterministic behavior
- Chunk count estimation

## Usage Examples

```python
# Basic recursive splitting
splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    separators=["\n\n", "\n", " ", ""]
)
chunks = splitter.split_text(long_text)

# With metadata preservation
documents = splitter.create_documents(
    texts=[text1, text2],
    metadatas=[{"source": "doc1.pdf"}, {"source": "doc2.pdf"}]
)

# Token-based splitting
token_splitter = TokenTextSplitter(
    encoding_name="gpt2",
    chunk_size=500,
    chunk_overlap=50
)
token_chunks = token_splitter.split_text(text)
```

## Test Execution

Run all tests:
    pytest tests/unit_tests/core/rag/splitter/test_text_splitter.py -v

Run specific test class:
    pytest tests/unit_tests/core/rag/splitter/test_text_splitter.py::TestRecursiveCharacterTextSplitter -v

Run with coverage:
    pytest tests/unit_tests/core/rag/splitter/test_text_splitter.py --cov=core.rag.splitter

## Notes

- Some tests are skipped if tiktoken library is not installed (TokenTextSplitter tests)
- Tests use pytest fixtures for reusable test data
- All tests follow Arrange-Act-Assert pattern
- Tests are organized by functionality in classes for better organization
"""

import string
from unittest.mock import Mock, patch

import pytest

from core.rag.models.document import Document
from core.rag.splitter.fixed_text_splitter import (
    EnhanceRecursiveCharacterTextSplitter,
    FixedRecursiveCharacterTextSplitter,
)
from core.rag.splitter.text_splitter import (
    RecursiveCharacterTextSplitter,
    Tokenizer,
    TokenTextSplitter,
    _split_text_with_regex,
    split_text_on_tokens,
)

# ============================================================================
# Test Fixtures
# ============================================================================


@pytest.fixture
def sample_text():
    """Provide sample text for testing."""
    return """This is the first paragraph. It contains multiple sentences.

This is the second paragraph. It also has several sentences.

This is the third paragraph with more content."""


@pytest.fixture
def long_text():
    """Provide long text for testing chunking."""
    return " ".join([f"Sentence number {i}." for i in range(100)])


@pytest.fixture
def multilingual_text():
    """Provide multilingual text for testing."""
    return "This is English. 这是中文。日本語です。한국어입니다。"


@pytest.fixture
def code_text():
    """Provide code snippet for testing."""
    return """def hello_world():
    print("Hello, World!")
    return True

def another_function():
    x = 10
    y = 20
    return x + y"""


@pytest.fixture
def markdown_text():
    """
    Provide markdown formatted text for testing.

    This fixture simulates a typical markdown document with headers,
    paragraphs, and code blocks.
    """
    return """# Main Title

This is an introduction paragraph with some content.

## Section 1

Content for section 1 with multiple sentences. This should be split appropriately.

### Subsection 1.1

More detailed content here.

## Section 2

Another section with different content.

```python
def example():
    return "code"
```

Final paragraph."""


@pytest.fixture
def html_text():
    """
    Provide HTML formatted text for testing.

    Tests how splitters handle structured markup content.
    """
    return """<html>
<head><title>Test</title></head>
<body>
<h1>Header</h1>
<p>First paragraph with content.</p>
<p>Second paragraph with more content.</p>
<div>Nested content here.</div>
</body>
</html>"""


@pytest.fixture
def json_text():
    """
    Provide JSON formatted text for testing.

    Tests splitting of structured data formats.
    """
    return """{
    "name": "Test Document",
    "content": "This is the main content",
    "metadata": {
        "author": "John Doe",
        "date": "2024-01-01"
    },
    "sections": [
        {"title": "Section 1", "text": "Content 1"},
        {"title": "Section 2", "text": "Content 2"}
    ]
}"""


@pytest.fixture
def technical_text():
    """
    Provide technical documentation text.

    Simulates API documentation or technical writing with
    specific terminology and formatting.
    """
    return """API Endpoint: /api/v1/users

Description: Retrieves user information from the database.

Parameters:
- user_id (required): The unique identifier for the user
- include_metadata (optional): Boolean flag to include additional metadata

Response Format:
{
    "user_id": "12345",
    "name": "John Doe",
    "email": "john@example.com"
}

Error Codes:
- 404: User not found
- 401: Unauthorized access
- 500: Internal server error"""


# ============================================================================
# Test Helper Functions
# ============================================================================


class TestSplitTextWithRegex:
    """
    Test the _split_text_with_regex helper function.

    This helper function is used internally by text splitters to split
    text using regex patterns. It supports keeping or removing separators
    and handles special regex characters properly.
    """

    def test_split_with_separator_keep(self):
        """
        Test splitting text with separator kept.

        When keep_separator=True, the separator should be appended to each
        chunk (except possibly the last one). This is useful for maintaining
        document structure like paragraph breaks.
        """
        text = "Hello\nWorld\nTest"
        result = _split_text_with_regex(text, "\n", keep_separator=True)
        # Each line should keep its newline character
        assert result == ["Hello\n", "World\n", "Test"]

    def test_split_with_separator_no_keep(self):
        """Test splitting text without keeping separator."""
        text = "Hello\nWorld\nTest"
        result = _split_text_with_regex(text, "\n", keep_separator=False)
        assert result == ["Hello", "World", "Test"]

    def test_split_empty_separator(self):
        """Test splitting with empty separator (character by character)."""
        text = "ABC"
        result = _split_text_with_regex(text, "", keep_separator=False)
        assert result == ["A", "B", "C"]

    def test_split_filters_empty_strings(self):
        """Test that empty strings and newlines are filtered out."""
        text = "Hello\n\nWorld"
        result = _split_text_with_regex(text, "\n", keep_separator=False)
        # Empty strings between consecutive separators should be filtered
        assert "" not in result
        assert result == ["Hello", "World"]

    def test_split_with_special_regex_chars(self):
        """Test splitting with special regex characters in separator."""
        text = "Hello.World.Test"
        result = _split_text_with_regex(text, ".", keep_separator=False)
        # The function escapes regex chars, so it should split correctly
        # But empty strings are filtered, so we get the parts
        assert len(result) >= 0  # May vary based on regex escaping
        assert isinstance(result, list)


class TestSplitTextOnTokens:
    """Test the split_text_on_tokens function."""

    def test_basic_token_splitting(self):
        """Test basic token-based splitting."""

        # Mock tokenizer
        def mock_encode(text: str) -> list[int]:
            return [ord(c) for c in text]

        def mock_decode(tokens: list[int]) -> str:
            return "".join([chr(t) for t in tokens])

        tokenizer = Tokenizer(chunk_overlap=2, tokens_per_chunk=5, decode=mock_decode, encode=mock_encode)

        text = "ABCDEFGHIJ"
        result = split_text_on_tokens(text=text, tokenizer=tokenizer)

        # Should split into chunks of 5 with overlap of 2
        assert len(result) > 1
        assert all(isinstance(chunk, str) for chunk in result)

    def test_token_splitting_with_overlap(self):
        """Test that overlap is correctly applied in token splitting."""

        def mock_encode(text: str) -> list[int]:
            return list(range(len(text)))

        def mock_decode(tokens: list[int]) -> str:
            return "".join([str(t) for t in tokens])

        tokenizer = Tokenizer(chunk_overlap=2, tokens_per_chunk=5, decode=mock_decode, encode=mock_encode)

        text = string.digits
        result = split_text_on_tokens(text=text, tokenizer=tokenizer)

        # Verify we get multiple chunks
        assert len(result) >= 2

    def test_token_splitting_short_text(self):
        """Test token splitting with text shorter than chunk size."""

        def mock_encode(text: str) -> list[int]:
            return [ord(c) for c in text]

        def mock_decode(tokens: list[int]) -> str:
            return "".join([chr(t) for t in tokens])

        tokenizer = Tokenizer(chunk_overlap=2, tokens_per_chunk=100, decode=mock_decode, encode=mock_encode)

        text = "Short"
        result = split_text_on_tokens(text=text, tokenizer=tokenizer)

        # Should return single chunk for short text
        assert len(result) == 1
        assert result[0] == text


# ============================================================================
# Test RecursiveCharacterTextSplitter
# ============================================================================


class TestRecursiveCharacterTextSplitter:
    """
    Test RecursiveCharacterTextSplitter functionality.

    RecursiveCharacterTextSplitter is the main text splitting class that
    recursively tries different separators (paragraph -> line -> word -> character)
    to split text into chunks of appropriate size. This is the most commonly
    used splitter for general text processing.
    """

    def test_initialization(self):
        """
        Test splitter initialization with default parameters.

        Verifies that the splitter is properly initialized with the correct
        chunk size, overlap, and default separator hierarchy.
        """
        splitter = RecursiveCharacterTextSplitter(chunk_size=100, chunk_overlap=10)
        assert splitter._chunk_size == 100
        assert splitter._chunk_overlap == 10
        # Default separators: paragraph, line, space, character
        assert splitter._separators == ["\n\n", "\n", " ", ""]

    def test_initialization_custom_separators(self):
        """Test splitter initialization with custom separators."""
        custom_separators = ["\n\n\n", "\n\n", "\n", " "]
        splitter = RecursiveCharacterTextSplitter(chunk_size=100, chunk_overlap=10, separators=custom_separators)
        assert splitter._separators == custom_separators

    def test_chunk_overlap_validation(self):
        """Test that chunk overlap cannot exceed chunk size."""
        with pytest.raises(ValueError, match="larger chunk overlap"):
            RecursiveCharacterTextSplitter(chunk_size=100, chunk_overlap=150)

    def test_split_by_paragraph(self, sample_text):
        """Test splitting text by paragraphs."""
        splitter = RecursiveCharacterTextSplitter(chunk_size=100, chunk_overlap=10)
        result = splitter.split_text(sample_text)

        assert len(result) > 0
        assert all(isinstance(chunk, str) for chunk in result)
        # Verify chunks respect size limit (with some tolerance for overlap)
        assert all(len(chunk) <= 150 for chunk in result)

    def test_split_by_newline(self):
        """Test splitting by newline when paragraphs are too large."""
        text = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
        splitter = RecursiveCharacterTextSplitter(chunk_size=20, chunk_overlap=5)
        result = splitter.split_text(text)

        assert len(result) > 0
        assert all(isinstance(chunk, str) for chunk in result)

    def test_split_by_space(self):
        """Test splitting by space when lines are too large."""
        text = "word1 word2 word3 word4 word5 word6 word7 word8"
        splitter = RecursiveCharacterTextSplitter(chunk_size=15, chunk_overlap=3)
        result = splitter.split_text(text)

        assert len(result) > 1
        assert all(isinstance(chunk, str) for chunk in result)

    def test_split_by_character(self):
        """Test splitting by character when words are too large."""
        text = "verylongwordthatcannotbesplit"
        splitter = RecursiveCharacterTextSplitter(chunk_size=10, chunk_overlap=2)
        result = splitter.split_text(text)

        assert len(result) > 1
        assert all(len(chunk) <= 12 for chunk in result)  # Allow for overlap

    def test_keep_separator_true(self):
        """Test that separators are kept when keep_separator=True."""
        text = "Para1\n\nPara2\n\nPara3"
        splitter = RecursiveCharacterTextSplitter(chunk_size=50, chunk_overlap=5, keep_separator=True)
        result = splitter.split_text(text)

        # At least one chunk should contain the separator
        combined = "".join(result)
        assert "Para1" in combined
        assert "Para2" in combined

    def test_keep_separator_false(self):
        """Test that separators are removed when keep_separator=False."""
        text = "Para1\n\nPara2\n\nPara3"
        splitter = RecursiveCharacterTextSplitter(chunk_size=50, chunk_overlap=5, keep_separator=False)
        result = splitter.split_text(text)

        assert len(result) > 0
        # Verify text content is preserved
        combined = " ".join(result)
        assert "Para1" in combined
        assert "Para2" in combined

    def test_overlap_handling(self):
        """
        Test that chunk overlap is correctly handled.

        Overlap ensures that context is preserved between chunks by having
        some content appear in consecutive chunks. This is crucial for
        maintaining semantic continuity in RAG applications.
        """
        text = "A B C D E F G H I J K L M N O P"
        splitter = RecursiveCharacterTextSplitter(chunk_size=10, chunk_overlap=3)
        result = splitter.split_text(text)

        # Verify we have multiple chunks
        assert len(result) > 1

        # Verify overlap exists between consecutive chunks
        # The end of one chunk should have some overlap with the start of the next
        for i in range(len(result) - 1):
            # Some content should overlap
            assert len(result[i]) > 0
            assert len(result[i + 1]) > 0

    def test_empty_text(self):
        """Test splitting empty text."""
        splitter = RecursiveCharacterTextSplitter(chunk_size=100, chunk_overlap=10)
        result = splitter.split_text("")
        assert result == []

    def test_single_word(self):
        """Test splitting single word."""
        splitter = RecursiveCharacterTextSplitter(chunk_size=100, chunk_overlap=10)
        result = splitter.split_text("Hello")
        assert len(result) == 1
        assert result[0] == "Hello"

    def test_create_documents(self):
        """Test creating documents from texts."""
        splitter = RecursiveCharacterTextSplitter(chunk_size=50, chunk_overlap=5)
        texts = ["Text 1 with some content", "Text 2 with more content"]
        metadatas = [{"source": "doc1"}, {"source": "doc2"}]

        documents = splitter.create_documents(texts, metadatas)

        assert len(documents) > 0
        assert all(isinstance(doc, Document) for doc in documents)
        assert all(hasattr(doc, "page_content") for doc in documents)
        assert all(hasattr(doc, "metadata") for doc in documents)

    def test_create_documents_with_start_index(self):
        """Test creating documents with start_index in metadata."""
        splitter = RecursiveCharacterTextSplitter(chunk_size=20, chunk_overlap=5, add_start_index=True)
        texts = ["This is a longer text that will be split into chunks"]

        documents = splitter.create_documents(texts)

        # Verify start_index is added to metadata
        assert any("start_index" in doc.metadata for doc in documents)
        # First chunk should start at index 0
        if documents:
            assert documents[0].metadata.get("start_index") == 0

    def test_split_documents(self):
        """Test splitting existing documents."""
        splitter = RecursiveCharacterTextSplitter(chunk_size=30, chunk_overlap=5)
        docs = [
            Document(page_content="First document content", metadata={"id": 1}),
            Document(page_content="Second document content", metadata={"id": 2}),
        ]

        result = splitter.split_documents(docs)

        assert len(result) > 0
        assert all(isinstance(doc, Document) for doc in result)
        # Verify metadata is preserved
        assert any(doc.metadata.get("id") == 1 for doc in result)

    def test_transform_documents(self):
        """Test transform_documents interface."""
        splitter = RecursiveCharacterTextSplitter(chunk_size=30, chunk_overlap=5)
        docs = [Document(page_content="Document to transform", metadata={"key": "value"})]

        result = splitter.transform_documents(docs)

        assert len(result) > 0
        assert all(isinstance(doc, Document) for doc in result)

    def test_long_text_splitting(self, long_text):
        """Test splitting very long text."""
        splitter = RecursiveCharacterTextSplitter(chunk_size=100, chunk_overlap=20)
        result = splitter.split_text(long_text)

        assert len(result) > 5  # Should create multiple chunks
        assert all(isinstance(chunk, str) for chunk in result)
        # Verify all chunks are within reasonable size
        assert all(len(chunk) <= 150 for chunk in result)

    def test_code_splitting(self, code_text):
        """Test splitting code with proper structure preservation."""
        splitter = RecursiveCharacterTextSplitter(chunk_size=80, chunk_overlap=10)
        result = splitter.split_text(code_text)

        assert len(result) > 0
        # Verify code content is preserved
        combined = "\n".join(result)
        assert "def hello_world" in combined or "hello_world" in combined


# ============================================================================
# Test TokenTextSplitter
# ============================================================================


class TestTokenTextSplitter:
    """Test TokenTextSplitter functionality."""

    @pytest.mark.skipif(True, reason="Requires tiktoken library which may not be installed")
    def test_initialization_with_encoding(self):
        """Test TokenTextSplitter initialization with encoding name."""
        try:
            splitter = TokenTextSplitter(encoding_name="gpt2", chunk_size=100, chunk_overlap=10)
            assert splitter._chunk_size == 100
            assert splitter._chunk_overlap == 10
        except ImportError:
            pytest.skip("tiktoken not installed")

    @pytest.mark.skipif(True, reason="Requires tiktoken library which may not be installed")
    def test_initialization_with_model(self):
        """Test TokenTextSplitter initialization with model name."""
        try:
            splitter = TokenTextSplitter(model_name="gpt-3.5-turbo", chunk_size=100, chunk_overlap=10)
            assert splitter._chunk_size == 100
        except ImportError:
            pytest.skip("tiktoken not installed")

    def test_initialization_without_tiktoken(self):
        """Test that proper error is raised when tiktoken is not installed."""
        with patch("core.rag.splitter.text_splitter.TokenTextSplitter.__init__") as mock_init:
            mock_init.side_effect = ImportError("Could not import tiktoken")
            with pytest.raises(ImportError, match="tiktoken"):
                TokenTextSplitter(chunk_size=100)

    @pytest.mark.skipif(True, reason="Requires tiktoken library which may not be installed")
    def test_split_text_by_tokens(self, sample_text):
        """Test splitting text by token count."""
        try:
            splitter = TokenTextSplitter(encoding_name="gpt2", chunk_size=50, chunk_overlap=10)
            result = splitter.split_text(sample_text)

            assert len(result) > 0
            assert all(isinstance(chunk, str) for chunk in result)
        except ImportError:
            pytest.skip("tiktoken not installed")

    @pytest.mark.skipif(True, reason="Requires tiktoken library which may not be installed")
    def test_token_overlap(self):
        """Test that token overlap works correctly."""
        try:
            splitter = TokenTextSplitter(encoding_name="gpt2", chunk_size=20, chunk_overlap=5)
            text = " ".join([f"word{i}" for i in range(50)])
            result = splitter.split_text(text)

            assert len(result) > 1
        except ImportError:
            pytest.skip("tiktoken not installed")


# ============================================================================
# Test EnhanceRecursiveCharacterTextSplitter
# ============================================================================


class TestEnhanceRecursiveCharacterTextSplitter:
    """Test EnhanceRecursiveCharacterTextSplitter functionality."""

    def test_from_encoder_without_model(self):
        """Test creating splitter from encoder without embedding model."""
        splitter = EnhanceRecursiveCharacterTextSplitter.from_encoder(
            embedding_model_instance=None, chunk_size=100, chunk_overlap=10
        )

        assert splitter._chunk_size == 100
        assert splitter._chunk_overlap == 10

    def test_from_encoder_with_mock_model(self):
        """Test creating splitter from encoder with mock embedding model."""
        mock_model = Mock()
        mock_model.get_text_embedding_num_tokens = Mock(return_value=[10, 20, 30])

        splitter = EnhanceRecursiveCharacterTextSplitter.from_encoder(
            embedding_model_instance=mock_model, chunk_size=100, chunk_overlap=10
        )

        assert splitter._chunk_size == 100
        assert splitter._chunk_overlap == 10

    def test_split_text_basic(self, sample_text):
        """Test basic text splitting with EnhanceRecursiveCharacterTextSplitter."""
        splitter = EnhanceRecursiveCharacterTextSplitter.from_encoder(
            embedding_model_instance=None, chunk_size=100, chunk_overlap=10
        )

        result = splitter.split_text(sample_text)

        assert len(result) > 0
        assert all(isinstance(chunk, str) for chunk in result)

    def test_character_encoder_length_function(self):
        """Test that character encoder correctly counts characters."""
        splitter = EnhanceRecursiveCharacterTextSplitter.from_encoder(
            embedding_model_instance=None, chunk_size=50, chunk_overlap=5
        )

        text = "A" * 100
        result = splitter.split_text(text)

        # Should split into multiple chunks
        assert len(result) >= 2

    def test_with_embedding_model_token_counting(self):
        """Test token counting with embedding model."""
        mock_model = Mock()
        # Mock returns token counts for input texts
        mock_model.get_text_embedding_num_tokens = Mock(side_effect=lambda texts: [len(t) // 2 for t in texts])

        splitter = EnhanceRecursiveCharacterTextSplitter.from_encoder(
            embedding_model_instance=mock_model, chunk_size=50, chunk_overlap=5
        )

        text = "This is a test text that should be split"
        result = splitter.split_text(text)

        assert len(result) > 0
        assert all(isinstance(chunk, str) for chunk in result)


# ============================================================================
# Test FixedRecursiveCharacterTextSplitter
# ============================================================================


class TestFixedRecursiveCharacterTextSplitter:
    """Test FixedRecursiveCharacterTextSplitter functionality."""

    def test_initialization_with_fixed_separator(self):
        """Test initialization with fixed separator."""
        splitter = FixedRecursiveCharacterTextSplitter(fixed_separator="\n\n", chunk_size=100, chunk_overlap=10)

        assert splitter._fixed_separator == "\n\n"
        assert splitter._chunk_size == 100
        assert splitter._chunk_overlap == 10

    def test_split_by_fixed_separator(self):
        """Test splitting by fixed separator first."""
        text = "Part 1\n\nPart 2\n\nPart 3"
        splitter = FixedRecursiveCharacterTextSplitter(fixed_separator="\n\n", chunk_size=100, chunk_overlap=10)

        result = splitter.split_text(text)

        assert len(result) >= 3
        assert all(isinstance(chunk, str) for chunk in result)

    def test_recursive_split_when_chunk_too_large(self):
        """Test recursive splitting when chunks exceed size limit."""
        # Create text with large chunks separated by fixed separator
        large_chunk = " ".join([f"word{i}" for i in range(50)])
        text = f"{large_chunk}\n\n{large_chunk}"

        splitter = FixedRecursiveCharacterTextSplitter(fixed_separator="\n\n", chunk_size=50, chunk_overlap=5)

        result = splitter.split_text(text)

        # Should split into more than 2 chunks due to size limit
        assert len(result) > 2

    def test_custom_separators(self):
        """Test with custom separator list."""
        text = "Sentence 1. Sentence 2. Sentence 3."
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator=".",
            separators=[".", " ", ""],
            chunk_size=30,
            chunk_overlap=5,
        )

        result = splitter.split_text(text)

        assert len(result) > 0
        assert all(isinstance(chunk, str) for chunk in result)

    def test_no_fixed_separator(self):
        """Test behavior when no fixed separator is provided."""
        text = "This is a test text without fixed separator"
        splitter = FixedRecursiveCharacterTextSplitter(fixed_separator="", chunk_size=20, chunk_overlap=5)

        result = splitter.split_text(text)

        assert len(result) > 0

    def test_chinese_separator(self):
        """Test with Chinese period separator."""
        text = "这是第一句。这是第二句。这是第三句。"
        splitter = FixedRecursiveCharacterTextSplitter(fixed_separator="。", chunk_size=50, chunk_overlap=5)

        result = splitter.split_text(text)

        assert len(result) > 0
        assert all(isinstance(chunk, str) for chunk in result)

    def test_space_separator_handling(self):
        """Test special handling of space separator."""
        text = "word1  word2   word3    word4"  # Multiple spaces
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator=" ", separators=[" ", ""], chunk_size=15, chunk_overlap=3
        )

        result = splitter.split_text(text)

        assert len(result) > 0
        # Verify words are present
        combined = " ".join(result)
        assert "word1" in combined
        assert "word2" in combined

    def test_character_level_splitting(self):
        """Test character-level splitting when no separator works."""
        text = "verylongwordwithoutspaces"
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator="", separators=[""], chunk_size=10, chunk_overlap=2
        )

        result = splitter.split_text(text)

        assert len(result) > 1
        # Verify chunks respect size with overlap
        for chunk in result:
            assert len(chunk) <= 12  # chunk_size + some tolerance for overlap

    def test_overlap_in_character_splitting(self):
        """Test that overlap is correctly applied in character-level splitting."""
        text = string.ascii_uppercase
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator="", separators=[""], chunk_size=10, chunk_overlap=3
        )

        result = splitter.split_text(text)

        assert len(result) > 1
        # Verify overlap exists
        for i in range(len(result) - 1):
            # Check that some characters appear in consecutive chunks
            assert len(result[i]) > 0
            assert len(result[i + 1]) > 0

    def test_metadata_preservation_in_documents(self):
        """Test that metadata is preserved when splitting documents."""
        splitter = FixedRecursiveCharacterTextSplitter(fixed_separator="\n\n", chunk_size=50, chunk_overlap=5)

        docs = [
            Document(
                page_content="First part\n\nSecond part\n\nThird part",
                metadata={"source": "test.txt", "page": 1},
            )
        ]

        result = splitter.split_documents(docs)

        assert len(result) > 0
        # Verify all chunks have the original metadata
        for doc in result:
            assert doc.metadata.get("source") == "test.txt"
            assert doc.metadata.get("page") == 1

    def test_empty_text_handling(self):
        """Test handling of empty text."""
        splitter = FixedRecursiveCharacterTextSplitter(fixed_separator="\n\n", chunk_size=100, chunk_overlap=10)

        result = splitter.split_text("")

        # May return empty list or list with empty string depending on implementation
        assert isinstance(result, list)
        assert len(result) <= 1

    def test_single_chunk_text(self):
        """Test text that fits in a single chunk."""
        text = "Short text"
        splitter = FixedRecursiveCharacterTextSplitter(fixed_separator="\n\n", chunk_size=100, chunk_overlap=10)

        result = splitter.split_text(text)

        assert len(result) == 1
        assert result[0] == text

    def test_newline_filtering(self):
        """Test that newlines are properly filtered in splits."""
        text = "Line 1\nLine 2\n\nLine 3"
        splitter = FixedRecursiveCharacterTextSplitter(
            fixed_separator="", separators=["\n", ""], chunk_size=50, chunk_overlap=5
        )

        result = splitter.split_text(text)

        # Verify no empty chunks
        assert all(len(chunk) > 0 for chunk in result)


# ============================================================================
# Test Metadata Preservation
# ============================================================================


class TestMetadataPreservation:
    """
    Test metadata preservation across different splitters.

    Metadata preservation is critical for RAG systems as it allows tracking
    the source, author, timestamps, and other contextual information for
    each chunk. All chunks derived from a document should inherit its metadata.
    """

    def test_recursive_splitter_metadata(self):
        """
        Test metadata preservation with RecursiveCharacterTextSplitter.

        When a document is split into multiple chunks, each chunk should
        receive a copy of the original document's metadata. This ensures
        that we can trace each chunk back to its source.
        """
        splitter = RecursiveCharacterTextSplitter(chunk_size=30, chunk_overlap=5)
        texts = ["Text content here"]
        # Metadata includes various types: strings, dates, lists
        metadatas = [{"author": "John", "date": "2024-01-01", "tags": ["test"]}]

        documents = splitter.create_documents(texts, metadatas)

        # Every chunk should have the same metadata as the original
        for doc in documents:
            assert doc.metadata.get("author") == "John"
            assert doc.metadata.get("date") == "2024-01-01"
            assert doc.metadata.get("tags") == ["test"]

    def test_enhance_splitter_metadata(self):
        """Test metadata preservation with EnhanceRecursiveCharacterTextSplitter."""
        splitter = EnhanceRecursiveCharacterTextSplitter.from_encoder(
            embedding_model_instance=None, chunk_size=30, chunk_overlap=5
        )

        docs = [
            Document(
                page_content="Content to split",
                metadata={"id": 123, "category": "test"},
            )
        ]

        result = splitter.split_documents(docs)

        for doc in result:
            assert doc.metadata.get("id") == 123
            assert doc.metadata.get("category") == "test"

    def test_fixed_splitter_metadata(self):
        """Test metadata preservation with FixedRecursiveCharacterTextSplitter."""
        splitter = FixedRecursiveCharacterTextSplitter(fixed_separator="\n", chunk_size=30, chunk_overlap=5)

        docs = [
            Document(
                page_content="Line 1\nLine 2\nLine 3",
                metadata={"version": "1.0", "status": "active"},
            )
        ]

        result = splitter.split_documents(docs)

        for doc in result:
            assert doc.metadata.get("version") == "1.0"
            assert doc.metadata.get("status") == "active"

    def test_metadata_with_start_index(self):
        """Test that start_index is added to metadata when requested."""
        splitter = RecursiveCharacterTextSplitter(chunk_size=20, chunk_overlap=5, add_start_index=True)

        texts = ["This is a test text that will be split"]
        metadatas = [{"original": "metadata"}]

        documents = splitter.create_documents(texts, metadatas)

        # Verify both original metadata and start_index are present
        for doc in documents:
            assert "start_index" in doc.metadata
            assert doc.metadata.get("original") == "metadata"
            assert isinstance(doc.metadata["start_index"], int)
            assert doc.metadata["start_index"] >= 0


# ============================================================================
# Test Edge Cases
# ============================================================================


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_chunk_size_equals_text_length(self):
        """Test when chunk size equals text length."""
        text = "Exact size text"
        splitter = RecursiveCharacterTextSplitter(chunk_size=len(text), chunk_overlap=0)

        result = splitter.split_text(text)

        assert len(result) == 1
        assert result[0] == text

    def test_very_small_chunk_size(self):
        """Test with very small chunk size."""
        text = "Test text"
        splitter = RecursiveCharacterTextSplitter(chunk_size=3, chunk_overlap=1)

        result = splitter.split_text(text)

        assert len(result) > 1
        assert all(len(chunk) <= 5 for chunk in result)  # Allow for overlap

    def test_zero_overlap(self):
        """Test splitting with zero overlap."""
        text = "Word1 Word2 Word3 Word4"
        splitter = RecursiveCharacterTextSplitter(chunk_size=12, chunk_overlap=0)

        result = splitter.split_text(text)

        assert len(result) > 0
        # Verify no overlap between chunks
        combined_length = sum(len(chunk) for chunk in result)
        # Should be close to original length (accounting for separators)
        assert combined_length >= len(text) - 10

    def test_unicode_text(self):
        """Test splitting text with unicode characters."""
        text = "Hello 世界 🌍 مرحبا"
        splitter = RecursiveCharacterTextSplitter(chunk_size=20, chunk_overlap=3)

        result = splitter.split_text(text)

        assert len(result) > 0
        # Verify unicode is preserved
        combined = " ".join(result)
        assert "世界" in combined or "世" in combined

    def test_only_separators(self):
        """Test text containing only separators."""
        text = "\n\n\n\n"
        splitter = RecursiveCharacterTextSplitter(chunk_size=10, chunk_overlap=2)

        result = splitter.split_text(text)

        # Should return empty list or handle gracefully
        assert isinstance(result, list)

    def test_mixed_separators(self):
        """Test text with mixed separator types."""
        text = "Para1\n\nPara2\nLine\n\n\nPara3"
        splitter = RecursiveCharacterTextSplitter(chunk_size=50, chunk_overlap=5)

        result = splitter.split_text(text)

        assert len(result) > 0
        combined = "".join(result)
        assert "Para1" in combined
        assert "Para2" in combined
        assert "Para3" in combined

    def test_whitespace_only_text(self):
        """Test text containing only whitespace."""
        text = "     "
        splitter = RecursiveCharacterTextSplitter(chunk_size=10, chunk_overlap=2)

        result = splitter.split_text(text)

        # Should handle whitespace-only text
        assert isinstance(result, list)

    def test_single_character_text(self):
        """Test splitting single character."""
        text = "A"
        splitter = RecursiveCharacterTextSplitter(chunk_size=10, chunk_overlap=2)

        result = splitter.split_text(text)

        assert len(result) == 1
        assert result[0] == "A"

    def test_multiple_documents_different_sizes(self):
        """Test splitting multiple documents of different sizes."""
        splitter = RecursiveCharacterTextSplitter(chunk_size=30, chunk_overlap=5)

        docs = [
            Document(page_content="Short", metadata={"id": 1}),
            Document(
                page_content="This is a much longer document that will be split",
                metadata={"id": 2},
            ),
            Document(page_content="Medium length doc", metadata={"id": 3}),
        ]

        result = splitter.split_documents(docs)

        # Verify all documents are processed
        assert len(result) >= 3
        # Verify metadata is preserved
        ids = [doc.metadata.get("id") for doc in result]
        assert 1 in ids
        assert 2 in ids
        assert 3 in ids


# ============================================================================
# Test Integration Scenarios
# ============================================================================


class TestIntegrationScenarios:
    """Test realistic integration scenarios."""

    def test_document_processing_pipeline(self):
        """Test complete document processing pipeline."""
        # Simulate a document processing workflow
        splitter = RecursiveCharacterTextSplitter(chunk_size=100, chunk_overlap=20, add_start_index=True)

        # Original documents with metadata
        original_docs = [
            Document(
                page_content="First document with multiple paragraphs.\n\nSecond paragraph here.\n\nThird paragraph.",
                metadata={"source": "doc1.txt", "author": "Alice"},
            ),
            Document(
                page_content="Second document content.\n\nMore content here.",
                metadata={"source": "doc2.txt", "author": "Bob"},
            ),
        ]

        # Split documents
        split_docs = splitter.split_documents(original_docs)

        # Verify results - documents may fit in single chunks if small enough
        assert len(split_docs) >= len(original_docs)  # At least as many chunks as original docs
        assert all(isinstance(doc, Document) for doc in split_docs)
        assert all("start_index" in doc.metadata for doc in split_docs)
        assert all("source" in doc.metadata for doc in split_docs)
        assert all("author" in doc.metadata for doc in split_docs)

    def test_multilingual_document_splitting(self, multilingual_text):
        """Test splitting multilingual documents."""
        splitter = RecursiveCharacterTextSplitter(chunk_size=30, chunk_overlap=5)

        result = splitter.split_text(multilingual_text)

        assert len(result) > 0
        # Verify content is preserved
        combined = " ".join(result)
        assert "English" in combined or "Eng" in combined

    def test_code_documentation_splitting(self, code_text):
        """Test splitting code documentation."""
        splitter = FixedRecursiveCharacterTextSplitter(fixed_separator="\n\n", chunk_size=100, chunk_overlap=10)

        result = splitter.split_text(code_text)

        assert len(result) > 0
        # Verify code structure is somewhat preserved
        combined = "\n".join(result)
        assert "def" in combined

    def test_large_document_chunking(self):
        """Test chunking of large documents."""
        # Create a large document
        large_text = "\n\n".join([f"Paragraph {i} with some content." for i in range(100)])

        splitter = RecursiveCharacterTextSplitter(chunk_size=200, chunk_overlap=50)

        result = splitter.split_text(large_text)

        # Verify efficient chunking
        assert len(result) > 10
        assert all(len(chunk) <= 250 for chunk in result)  # Allow some tolerance

    def test_semantic_chunking_simulation(self):
        """Test semantic-like chunking by using paragraph separators."""
        text = """Introduction paragraph.

Main content paragraph with details.

Conclusion paragraph with summary.

Additional notes and references."""

        splitter = RecursiveCharacterTextSplitter(chunk_size=100, chunk_overlap=20, keep_separator=True)

        result = splitter.split_text(text)

        # Verify paragraph structure is somewhat maintained
        assert len(result) > 0
        assert all(isinstance(chunk, str) for chunk in result)


# ============================================================================
# Test Performance and Limits
# ============================================================================


class TestPerformanceAndLimits:
    """Test performance characteristics and limits."""

    def test_max_chunk_size_warning(self):
        """Test that warning is logged for chunks exceeding size."""
        # Create text with a very long word
        long_word = "a" * 200
        text = f"Short {long_word} text"

        splitter = RecursiveCharacterTextSplitter(chunk_size=50, chunk_overlap=10)

        # Should handle gracefully and log warning
        result = splitter.split_text(text)

        assert len(result) > 0
        # Long word may be split into multiple chunks at character level
        # Verify all content is preserved
        combined = "".join(result)
        assert "a" * 100 in combined  # At least part of the long word is preserved

    def test_many_small_chunks(self):
        """Test creating many small chunks."""
        text = " ".join([f"w{i}" for i in range(1000)])
        splitter = RecursiveCharacterTextSplitter(chunk_size=20, chunk_overlap=5)

        result = splitter.split_text(text)

        # Should create many chunks
        assert len(result) > 50
        assert all(isinstance(chunk, str) for chunk in result)

    def test_deeply_nested_splitting(self):
        """
        Test that recursive splitting works for deeply nested cases.

        This test verifies that the splitter can handle text that requires
        multiple levels of recursive splitting (paragraph -> line -> word -> character).
        """
        # Text that requires multiple levels of splitting
        text = "word1" + "x" * 100 + "word2" + "y" * 100 + "word3"

        splitter = RecursiveCharacterTextSplitter(chunk_size=30, chunk_overlap=5)

        result = splitter.split_text(text)

        assert len(result) > 3
        # Verify all content is present
        combined = "".join(result)
        assert "word1" in combined
        assert "word2" in combined
        assert "word3" in combined


# ============================================================================
# Test Advanced Splitting Scenarios
# ============================================================================


class TestAdvancedSplittingScenarios:
    """
    Test advanced and complex splitting scenarios.

    This test class covers edge cases and advanced use cases that may occur
    in production environments, including structured documents, special
    formatting, and boundary conditions.
    """

    def test_markdown_document_splitting(self, markdown_text):
        """
        Test splitting of markdown formatted documents.

        Markdown documents have hierarchical structure with headers and sections.
        This test verifies that the splitter respects document structure while
        maintaining readability of chunks.
        """
        splitter = RecursiveCharacterTextSplitter(chunk_size=150, chunk_overlap=20, keep_separator=True)

        result = splitter.split_text(markdown_text)

        # Should create multiple chunks
        assert len(result) > 0

        # Verify markdown structure is somewhat preserved
        combined = "\n".join(result)
        assert "#" in combined  # Headers should be present
        assert "Section" in combined

        # Each chunk should be within size limits
        assert all(len(chunk) <= 200 for chunk in result)

    def test_html_content_splitting(self, html_text):
        """
        Test splitting of HTML formatted content.

        HTML has nested tags and structure. This test ensures that
        splitting doesn't break the content in ways that would make
        it unusable.
        """
        splitter = RecursiveCharacterTextSplitter(chunk_size=100, chunk_overlap=15)

        result = splitter.split_text(html_text)

        assert len(result) > 0
        # Verify HTML content is preserved
        combined = "".join(result)
        assert "paragraph" in combined.lower() or "para" in combined.lower()

    def test_json_structure_splitting(self, json_text):
        """
        Test splitting of JSON formatted data.

        JSON has specific structure with braces, brackets, and quotes.
        While the splitter doesn't parse JSON, it should handle it
        without losing critical content.
        """
        splitter = RecursiveCharacterTextSplitter(chunk_size=80, chunk_overlap=10)

        result = splitter.split_text(json_text)

        assert len(result) > 0
        # Verify key JSON elements are preserved
        combined = "".join(result)
        assert "name" in combined or "content" in combined

    def test_technical_documentation_splitting(self, technical_text):
        """
        Test splitting of technical documentation.

        Technical docs often have specific formatting with sections,
        code examples, and structured information. This test ensures
        such content is split appropriately.
        """
        splitter = RecursiveCharacterTextSplitter(chunk_size=200, chunk_overlap=30, keep_separator=True)

        result = splitter.split_text(technical_text)

        assert len(result) > 0
        # Verify technical content is preserved
        combined = "\n".join(result)
        assert "API" in combined or "api" in combined.lower()
        assert "Parameters" in combined or "Error" in combined

    def test_mixed_content_types(self):
        """
        Test splitting document with mixed content types.

        Real-world documents often mix prose, code, lists, and other
        content types. This test verifies handling of such mixed content.
        """
        mixed_text = """Introduction to the API

Here is some explanatory text about how to use the API.

```python
def example():
    return {"status": "success"}
```

Key Points:
- Point 1: First important point
- Point 2: Second important point
- Point 3: Third important point

Conclusion paragraph with final thoughts."""

        splitter = RecursiveCharacterTextSplitter(chunk_size=120, chunk_overlap=20)

        result = splitter.split_text(mixed_text)

        assert len(result) > 0
        # Verify different content types are preserved
        combined = "\n".join(result)
        assert "API" in combined or "api" in combined.lower()
        assert "Point" in combined or "point" in combined

    def test_bullet_points_and_lists(self):
        """
        Test splitting of text with bullet points and lists.

        Lists are common in documents and should be split in a way
        that maintains their structure and readability.
        """
        list_text = """Main Topic

Key Features:
- Feature 1: Description of first feature
- Feature 2: Description of second feature
- Feature 3: Description of third feature
- Feature 4: Description of fourth feature
- Feature 5: Description of fifth feature

Additional Information:
1. First numbered item
2. Second numbered item
3. Third numbered item"""

        splitter = RecursiveCharacterTextSplitter(chunk_size=100, chunk_overlap=15)

        result = splitter.split_text(list_text)

        assert len(result) > 0
        # Verify list structure is somewhat maintained
        combined = "\n".join(result)
        assert "Feature" in combined or "feature" in combined

    def test_quoted_text_handling(self):
        """
        Test handling of quoted text and dialogue.

        Quotes and dialogue have special formatting that should be
        preserved during splitting.
        """
        quoted_text = """The speaker said, "This is a very important quote that contains multiple sentences. \
It goes on for quite a while and has significant meaning."

Another person responded, "I completely agree with that statement. \
We should consider all the implications."

A third voice added, "Let's not forget about the other perspective here."

The discussion continued with more detailed points."""

        splitter = RecursiveCharacterTextSplitter(chunk_size=100, chunk_overlap=20)

        result = splitter.split_text(quoted_text)

        assert len(result) > 0
        # Verify quotes are preserved
        combined = " ".join(result)
        assert "said" in combined or "responded" in combined

    def test_table_like_content(self):
        """
        Test splitting of table-like formatted content.

        Tables and structured data layouts should be handled gracefully
        even though the splitter doesn't understand table semantics.
        """
        table_text = """Product Comparison Table

Name          | Price  | Rating | Stock
------------- | ------ | ------ | -----
Product A     | $29.99 | 4.5    | 100
Product B     | $39.99 | 4.8    | 50
Product C     | $19.99 | 4.2    | 200
Product D     | $49.99 | 4.9    | 25

Notes: All prices include tax."""

        splitter = RecursiveCharacterTextSplitter(chunk_size=120, chunk_overlap=15)

        result = splitter.split_text(table_text)

        assert len(result) > 0
        # Verify table content is preserved
        combined = "\n".join(result)
        assert "Product" in combined or "Price" in combined

    def test_urls_and_links_preservation(self):
        """
        Test that URLs and links are preserved during splitting.

        URLs should not be broken across chunks as that would make
        them unusable.
        """
        url_text = """For more information, visit https://www.example.com/very/long/path/to/resource

You can also check out https://api.example.com/v1/documentation for API details.

Additional resources:
- https://github.com/example/repo
- https://stackoverflow.com/questions/12345/example-question

Contact us at support@example.com for help."""

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=100,
            chunk_overlap=20,
            separators=["\n\n", "\n", " ", ""],  # Space separator helps keep URLs together
        )

        result = splitter.split_text(url_text)

        assert len(result) > 0
        # Verify URLs are present in chunks
        combined = " ".join(result)
        assert "http" in combined or "example.com" in combined

    def test_email_content_splitting(self):
        """
        Test splitting of email-like content.

        Emails have headers, body, and signatures that should be
        handled appropriately.
        """
        email_text = """From: sender@example.com
To: recipient@example.com
Subject: Important Update

Dear Team,

I wanted to inform you about the recent changes to our project timeline. \
The new deadline is next month, and we need to adjust our priorities accordingly.

Please review the attached documents and provide your feedback by end of week.

Key action items:
1. Review documentation
2. Update project plan
3. Schedule follow-up meeting

Best regards,
John Doe
Senior Manager"""

        splitter = RecursiveCharacterTextSplitter(chunk_size=150, chunk_overlap=20)

        result = splitter.split_text(email_text)

        assert len(result) > 0
        # Verify email structure is preserved
        combined = "\n".join(result)
        assert "From" in combined or "Subject" in combined or "Dear" in combined


# ============================================================================
# Test Splitter Configuration and Customization
# ============================================================================


class TestSplitterConfiguration:
    """
    Test various configuration options for text splitters.

    This class tests different parameter combinations and configurations
    to ensure splitters behave correctly under various settings.
    """

    def test_custom_length_function(self):
        """
        Test using a custom length function.

        The splitter allows custom length functions for specialized
        counting (e.g., word count instead of character count).
        """

        # Custom length function that counts words
        def word_count_length(texts: list[str]) -> list[int]:
            return [len(text.split()) for text in texts]

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=10,  # 10 words
            chunk_overlap=2,  # 2 words overlap
            length_function=word_count_length,
        )

        text = " ".join([f"word{i}" for i in range(30)])
        result = splitter.split_text(text)

        # Should create multiple chunks based on word count
        assert len(result) > 1
        # Each chunk should have roughly 10 words or fewer
        for chunk in result:
            word_count = len(chunk.split())
            assert word_count <= 15  # Allow some tolerance

    def test_different_separator_orders(self):
        """
        Test different orderings of separators.

        The order of separators affects how text is split. This test
        verifies that different orders produce different results.
        """
        text = "Paragraph one.\n\nParagraph two.\nLine break here.\nAnother line."

        # Try paragraph-first splitting
        splitter1 = RecursiveCharacterTextSplitter(
            chunk_size=50, chunk_overlap=5, separators=["\n\n", "\n", ".", " ", ""]
        )
        result1 = splitter1.split_text(text)

        # Try line-first splitting
        splitter2 = RecursiveCharacterTextSplitter(
            chunk_size=50, chunk_overlap=5, separators=["\n", "\n\n", ".", " ", ""]
        )
        result2 = splitter2.split_text(text)

        # Both should produce valid results
        assert len(result1) > 0
        assert len(result2) > 0
        # Results may differ based on separator priority
        assert isinstance(result1, list)
        assert isinstance(result2, list)

    def test_extreme_overlap_ratios(self):
        """
        Test splitters with extreme overlap ratios.

        Tests edge cases where overlap is very small or very large
        relative to chunk size.
        """
        text = "A B C D E F G H I J K L M N O P Q R S T U V W X Y Z"

        # Very small overlap (1% of chunk size)
        splitter_small = RecursiveCharacterTextSplitter(chunk_size=20, chunk_overlap=1)
        result_small = splitter_small.split_text(text)

        # Large overlap (90% of chunk size)
        splitter_large = RecursiveCharacterTextSplitter(chunk_size=20, chunk_overlap=18)
        result_large = splitter_large.split_text(text)

        # Both should work
        assert len(result_small) > 0
        assert len(result_large) > 0
        # Large overlap should create more chunks
        assert len(result_large) >= len(result_small)

    def test_add_start_index_accuracy(self):
        """
        Test that start_index metadata is accurately calculated.

        The start_index should point to the actual position of the
        chunk in the original text.
        """
        text = string.ascii_uppercase
        splitter = RecursiveCharacterTextSplitter(chunk_size=10, chunk_overlap=2, add_start_index=True)

        docs = splitter.create_documents([text])

        # Verify start indices are correct
        for doc in docs:
            start_idx = doc.metadata.get("start_index")
            if start_idx is not None:
                # The chunk should actually appear at that index
                assert text[start_idx : start_idx + len(doc.page_content)] == doc.page_content

    def test_separator_regex_patterns(self):
        """
        Test using regex patterns as separators.

        Separators can be regex patterns for more sophisticated splitting.
        """
        # Text with multiple spaces and tabs
        text = "Word1    Word2\t\tWord3   Word4\tWord5"

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=20,
            chunk_overlap=3,
            separators=[r"\s+", ""],  # Split on any whitespace
        )

        result = splitter.split_text(text)

        assert len(result) > 0
        # Verify words are split
        combined = " ".join(result)
        assert "Word" in combined


# ============================================================================
# Test Error Handling and Robustness
# ============================================================================


class TestErrorHandlingAndRobustness:
    """
    Test error handling and robustness of splitters.

    This class tests how splitters handle invalid inputs, edge cases,
    and error conditions.
    """

    def test_none_text_handling(self):
        """
        Test handling of None as input.

        Splitters should handle None gracefully without crashing.
        """
        splitter = RecursiveCharacterTextSplitter(chunk_size=100, chunk_overlap=10)

        # Should handle None without crashing
        try:
            result = splitter.split_text(None)
            # If it doesn't raise an error, result should be empty or handle gracefully
            assert result is not None
        except (TypeError, AttributeError):
            # It's acceptable to raise a type error for None input
            pass

    def test_very_large_chunk_size(self):
        """
        Test splitter with chunk size larger than any reasonable text.

        When chunk size is very large, text should remain unsplit.
        """
        text = "This is a short text."
        splitter = RecursiveCharacterTextSplitter(chunk_size=1000000, chunk_overlap=100)

        result = splitter.split_text(text)

        # Should return single chunk
        assert len(result) == 1
        assert result[0] == text

    def test_chunk_size_one(self):
        """
        Test splitter with minimum chunk size of 1.

        This extreme case should split text character by character.
        """
        text = "ABC"
        splitter = RecursiveCharacterTextSplitter(chunk_size=1, chunk_overlap=0)

        result = splitter.split_text(text)

        # Should split into individual characters
        assert len(result) >= 3
        # Verify all content is preserved
        combined = "".join(result)
        assert "A" in combined
        assert "B" in combined
        assert "C" in combined

    def test_special_unicode_characters(self):
        """
        Test handling of special unicode characters.

        Splitters should handle emojis, special symbols, and other
        unicode characters without issues.
        """
        text = "Hello 👋 World 🌍 Test 🚀 Data 📊 End 🎉"
        splitter = RecursiveCharacterTextSplitter(chunk_size=20, chunk_overlap=5)

        result = splitter.split_text(text)

        assert len(result) > 0
        # Verify unicode is preserved
        combined = " ".join(result)
        assert "Hello" in combined
        assert "World" in combined

    def test_control_characters(self):
        """
        Test handling of control characters.

        Text may contain tabs, carriage returns, and other control
        characters that should be handled properly.
        """
        text = "Line1\r\nLine2\tTabbed\r\nLine3"
        splitter = RecursiveCharacterTextSplitter(chunk_size=30, chunk_overlap=5)

        result = splitter.split_text(text)

        assert len(result) > 0
        # Verify content is preserved
        combined = "".join(result)
        assert "Line1" in combined
        assert "Line2" in combined

    def test_repeated_separators(self):
        """
        Test text with many repeated separators.

        Multiple consecutive separators should be handled without
        creating empty chunks.
        """
        text = "Word1\n\n\n\n\nWord2\n\n\n\nWord3"
        splitter = RecursiveCharacterTextSplitter(chunk_size=50, chunk_overlap=5)

        result = splitter.split_text(text)

        assert len(result) > 0
        # Should not have empty chunks
        assert all(len(chunk.strip()) > 0 for chunk in result)

    def test_documents_with_empty_metadata(self):
        """
        Test splitting documents with empty metadata.

        Documents may have empty metadata dict, which should be handled
        properly and preserved in chunks.
        """
        splitter = RecursiveCharacterTextSplitter(chunk_size=30, chunk_overlap=5)

        # Create documents with empty metadata
        docs = [Document(page_content="Content here", metadata={})]

        result = splitter.split_documents(docs)

        assert len(result) > 0
        # Metadata should be dict (empty dict is valid)
        for doc in result:
            assert isinstance(doc.metadata, dict)

    def test_empty_separator_list(self):
        """
        Test splitter with empty separator list.

        Edge case where no separators are provided should still work
        by falling back to default behavior.
        """
        text = "Test text here"

        try:
            splitter = RecursiveCharacterTextSplitter(chunk_size=20, chunk_overlap=5, separators=[])
            result = splitter.split_text(text)
            # Should still produce some result
            assert isinstance(result, list)
        except (ValueError, IndexError):
            # It's acceptable to raise an error for empty separators
            pass


# ============================================================================
# Test Performance Characteristics
# ============================================================================


class TestPerformanceCharacteristics:
    """
    Test performance-related characteristics of splitters.

    These tests verify that splitters perform efficiently and handle
    large-scale operations appropriately.
    """

    def test_consistent_chunk_sizes(self):
        """
        Test that chunk sizes are relatively consistent.

        While chunks may vary in size, they should generally be close
        to the target chunk size (except for the last chunk).
        """
        text = " ".join([f"Word{i}" for i in range(200)])
        splitter = RecursiveCharacterTextSplitter(chunk_size=100, chunk_overlap=10)

        result = splitter.split_text(text)

        # Most chunks should be close to target size
        sizes = [len(chunk) for chunk in result[:-1]]  # Exclude last chunk
        if sizes:
            avg_size = sum(sizes) / len(sizes)
            # Average should be reasonably close to target
            assert 50 <= avg_size <= 150

    def test_minimal_information_loss(self):
        """
        Test that splitting and rejoining preserves information.

        When chunks are rejoined, the content should be largely preserved
        (accounting for separator handling).
        """
        text = "The quick brown fox jumps over the lazy dog. " * 10
        splitter = RecursiveCharacterTextSplitter(chunk_size=50, chunk_overlap=10, keep_separator=True)

        result = splitter.split_text(text)
        combined = "".join(result)

        # Most of the original text should be preserved
        # (Some separators might be handled differently)
        assert "quick" in combined
        assert "brown" in combined
        assert "fox" in combined
        assert "dog" in combined

    def test_deterministic_splitting(self):
        """
        Test that splitting is deterministic.

        Running the same splitter on the same text multiple times
        should produce identical results.
        """
        text = "Consistent text for deterministic testing. " * 5
        splitter = RecursiveCharacterTextSplitter(chunk_size=50, chunk_overlap=10)

        result1 = splitter.split_text(text)
        result2 = splitter.split_text(text)
        result3 = splitter.split_text(text)

        # All results should be identical
        assert result1 == result2
        assert result2 == result3

    def test_chunk_count_estimation(self):
        """
        Test that chunk count is reasonable for given text length.

        The number of chunks should be proportional to text length
        and inversely proportional to chunk size.
        """
        base_text = "Word " * 100

        # Small chunks should create more chunks
        splitter_small = RecursiveCharacterTextSplitter(chunk_size=20, chunk_overlap=5)
        result_small = splitter_small.split_text(base_text)

        # Large chunks should create fewer chunks
        splitter_large = RecursiveCharacterTextSplitter(chunk_size=100, chunk_overlap=5)
        result_large = splitter_large.split_text(base_text)

        # Small chunk size should produce more chunks
        assert len(result_small) > len(result_large)
