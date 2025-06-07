import os
import sys

# Add the current directory to the Python path
sys.path.insert(0, os.path.abspath('.'))

from flask import Flask
from api.core.model_manager import ModelManager
from api.core.model_runtime.entities.model_entities import ModelType
from api.core.rag.splitter.fixed_text_splitter import FixedRecursiveCharacterTextSplitter
from api.core.rag.splitter.semantic_text_splitter import SemanticTextSplitter
from api.core.rag.models.document import Document

# Sample text with distinct semantic sections
sample_text = """
# Introduction to Machine Learning

Machine learning is a field of artificial intelligence that enables systems to learn and improve from experience without being explicitly programmed. It focuses on developing algorithms that can access data and use it to learn for themselves.

## Supervised Learning

Supervised learning is a type of machine learning where the algorithm learns from labeled training data. The model makes predictions based on evidence in the presence of uncertainty.

Common supervised learning tasks include:
- Classification: categorizing data into predefined classes
- Regression: predicting continuous values
- Forecasting: predicting future values based on historical data

## Unsupervised Learning

Unsupervised learning algorithms find patterns in unlabeled data. These models discover hidden structures in data without the need for human intervention.

Typical unsupervised learning techniques include:
- Clustering: grouping similar data points together
- Dimensionality reduction: reducing the number of variables in data
- Association: identifying rules that describe portions of your data
"""

def test_semantic_chunking():
    print("Testing Semantic Chunking Implementation")
    print("-" * 50)
    
    app = Flask(__name__)
    with app.app_context():
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
                
            # Analyze the quality of chunk boundaries
            print("\nAnalyzing chunk boundaries:")
            natural_boundaries = [".", "!", "?"]
            semantic_complete_sentences = sum(1 for chunk in semantic_chunks if chunk.strip()[-1] in natural_boundaries)
            fixed_complete_sentences = sum(1 for chunk in fixed_chunks if chunk.strip()[-1] in natural_boundaries)
            
            print(f"Fixed chunking: {fixed_complete_sentences}/{len(fixed_chunks)} chunks end with complete sentences")
            print(f"Semantic chunking: {semantic_complete_sentences}/{len(semantic_chunks)} chunks end with complete sentences")
            
            # Check if there are section headings split across chunks
            fixed_headings_split = sum(1 for chunk in fixed_chunks if chunk.strip().startswith('#') and not chunk.strip().split('\n')[0].endswith('\n'))
            semantic_headings_split = sum(1 for chunk in semantic_chunks if chunk.strip().startswith('#') and not chunk.strip().split('\n')[0].endswith('\n'))
            
            print(f"Fixed chunking: {fixed_headings_split} chunks have headings split from their content")
            print(f"Semantic chunking: {semantic_headings_split} chunks have headings split from their content")
        else:
            print("\nSkipping semantic chunking test as no LLM is available")

if __name__ == "__main__":
    test_semantic_chunking() 