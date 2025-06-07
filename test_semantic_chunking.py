from api.core.model_manager import ModelManager
from api.core.model_runtime.entities.model_entities import ModelType
from api.core.rag.splitter.fixed_text_splitter import FixedRecursiveCharacterTextSplitter
from api.core.rag.splitter.semantic_text_splitter import SemanticTextSplitter
from api.core.rag.models.document import Document

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

def test_chunking():
    print("Testing semantic chunking vs. fixed chunking")
    print("-" * 50)
    
    # Get model instances
    model_manager = ModelManager()
    try:
        llm_model_instance = model_manager.get_default_model_instance(ModelType.LLM)
        print(f"Using LLM: {llm_model_instance.model} from {llm_model_instance.provider}")
    except Exception as e:
        print(f"Could not get LLM model instance: {e}")
        print("Continuing with fixed chunking only for comparison")
        llm_model_instance = None
    
    try:
        embedding_model_instance = model_manager.get_default_model_instance(ModelType.TEXT_EMBEDDING)
        print(f"Using embedding model: {embedding_model_instance.model} from {embedding_model_instance.provider}")
    except Exception as e:
        print(f"Could not get embedding model instance: {e}")
        embedding_model_instance = None
    
    # Create document from sample text
    doc = Document(page_content=sample_text)
    
    # Fixed chunking
    fixed_splitter = FixedRecursiveCharacterTextSplitter(
        chunk_size=200,
        chunk_overlap=20,
    )
    fixed_chunks = fixed_splitter.split_text(sample_text)
    
    print("\nFixed Chunking Results:")
    print(f"Number of chunks: {len(fixed_chunks)}")
    for i, chunk in enumerate(fixed_chunks):
        print(f"\nChunk {i+1} ({len(chunk)} chars):")
        print(chunk[:100] + "..." if len(chunk) > 100 else chunk)
    
    # Semantic chunking (if LLM is available)
    if llm_model_instance:
        semantic_splitter = SemanticTextSplitter(
            llm_model_instance=llm_model_instance,
            chunk_size=200,
            chunk_overlap=20,
        )
        semantic_chunks = semantic_splitter.split_text(sample_text)
        
        print("\nSemantic Chunking Results:")
        print(f"Number of chunks: {len(semantic_chunks)}")
        for i, chunk in enumerate(semantic_chunks):
            print(f"\nChunk {i+1} ({len(chunk)} chars):")
            print(chunk[:100] + "..." if len(chunk) > 100 else chunk)
    else:
        print("\nSkipping semantic chunking test as no LLM is available")

if __name__ == "__main__":
    test_chunking() 