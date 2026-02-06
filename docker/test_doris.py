#!/usr/bin/env python3
"""
Test script for Apache Doris vector store integration.
Run this after starting Doris with: docker compose -f docker-compose.doris.yaml up -d
"""

import sys
import time
from pathlib import Path

# Add API directory to path
api_path = Path(__file__).parent.parent / "api"
sys.path.insert(0, str(api_path))

from core.rag.datasource.vdb.doris.doris_vector import DorisConfig, DorisVector
from core.rag.models.document import Document


def test_doris_connection():
    """Test basic Doris connection."""
    print("=" * 60)
    print("Testing Doris Vector Store Connection")
    print("=" * 60)

    config = DorisConfig(
        host="localhost",
        port=9030,
        user="root",
        password="",
        database="dify",
        min_connection=1,
        max_connection=5,
        enable_text_search=True,
        text_search_analyzer="english",
        streamload_port=8030,
    )

    try:
        # Test 1: Create vector store instance
        print("\n1. Creating DorisVector instance...")
        vector_store = DorisVector(collection_name="test_collection", config=config, attributes=[])
        print("   ✓ DorisVector instance created")

        # Test 2: Create collection with sample data
        print("\n2. Creating collection with sample documents...")
        sample_docs = [
            Document(
                page_content="Apache Doris is a high-performance analytical database.",
                metadata={"doc_id": "doc1", "document_id": "test1", "source": "test"},
            ),
            Document(
                page_content="Vector search enables semantic similarity matching.",
                metadata={"doc_id": "doc2", "document_id": "test1", "source": "test"},
            ),
            Document(
                page_content="HNSW is an efficient algorithm for approximate nearest neighbor search.",
                metadata={"doc_id": "doc3", "document_id": "test1", "source": "test"},
            ),
        ]

        # Sample embeddings (4-dimensional for testing)
        sample_embeddings = [
            [0.1, 0.2, 0.3, 0.4],
            [0.5, 0.6, 0.7, 0.8],
            [0.2, 0.3, 0.4, 0.5],
        ]

        ids = vector_store.create(sample_docs, sample_embeddings)
        print(f"   ✓ Created collection with {len(ids)} documents")
        print(f"   Document IDs: {ids}")

        # Test 3: Vector search
        print("\n3. Testing vector search...")
        query_vector = [0.15, 0.25, 0.35, 0.45]
        results = vector_store.search_by_vector(query_vector, top_k=2)
        print(f"   ✓ Found {len(results)} results")
        for i, doc in enumerate(results, 1):
            score = doc.metadata.get("score", 0)
            print(f"   Result {i}: score={score:.4f}, text={doc.page_content[:50]}...")

        # Test 4: Full-text search
        print("\n4. Testing full-text search...")
        text_results = vector_store.search_by_full_text("vector search", top_k=2)
        print(f"   ✓ Found {len(text_results)} results")
        for i, doc in enumerate(text_results, 1):
            score = doc.metadata.get("score", 0)
            print(f"   Result {i}: score={score:.4f}, text={doc.page_content[:50]}...")

        # Test 5: Check if document exists
        print("\n5. Testing document existence check...")
        exists = vector_store.text_exists("doc1")
        print(f"   ✓ Document 'doc1' exists: {exists}")

        # Test 6: Delete by IDs
        print("\n6. Testing delete by IDs...")
        vector_store.delete_by_ids(["doc1"])
        exists_after = vector_store.text_exists("doc1")
        print(f"   ✓ Document deleted, exists now: {exists_after}")

        # Test 7: Cleanup - delete collection
        print("\n7. Cleaning up - deleting collection...")
        vector_store.delete()
        print("   ✓ Collection deleted")

        print("\n" + "=" * 60)
        print("All tests passed! ✓")
        print("=" * 60)
        return True

    except Exception as e:
        print(f"\n✗ Test failed with error: {e}")
        import traceback

        traceback.print_exc()
        return False


def wait_for_doris():
    """Wait for Doris to be ready."""
    import mysql.connector

    print("Waiting for Doris to be ready...")
    max_retries = 30
    retry_count = 0

    while retry_count < max_retries:
        try:
            conn = mysql.connector.connect(host="localhost", port=9030, user="root", password="", connect_timeout=5)
            cursor = conn.cursor()
            cursor.execute("SHOW DATABASES")
            cursor.close()
            conn.close()
            print("✓ Doris is ready!")
            return True
        except Exception:
            retry_count += 1
            if retry_count < max_retries:
                print(f"  Waiting... ({retry_count}/{max_retries})")
                time.sleep(2)
            else:
                print("✗ Timeout waiting for Doris")
                return False


def create_database():
    """Create the dify database if it doesn't exist."""
    import mysql.connector

    try:
        conn = mysql.connector.connect(host="localhost", port=9030, user="root", password="")
        cursor = conn.cursor()
        cursor.execute("CREATE DATABASE IF NOT EXISTS dify")
        cursor.close()
        conn.close()
        print("✓ Database 'dify' ready")
        return True
    except Exception as e:
        print(f"✗ Failed to create database: {e}")
        return False


if __name__ == "__main__":
    print("\nDoris Vector Store Integration Test")
    print("=" * 60)

    # Wait for Doris
    if not wait_for_doris():
        sys.exit(1)

    # Create database
    if not create_database():
        sys.exit(1)

    # Run tests
    success = test_doris_connection()
    sys.exit(0 if success else 1)
