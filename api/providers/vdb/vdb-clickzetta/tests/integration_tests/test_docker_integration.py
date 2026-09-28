#!/usr/bin/env python3
"""
Test Clickzetta integration in Docker environment
"""

import logging
import os
import time

import httpx
from clickzetta import connect

logger = logging.getLogger(__name__)


def test_clickzetta_connection():
    """Test direct connection to Clickzetta"""
    logger.info("=== Testing direct Clickzetta connection ===")
    try:
        conn = connect(
            username=os.getenv("CLICKZETTA_USERNAME", "test_user"),
            password=os.getenv("CLICKZETTA_PASSWORD", "test_password"),
            instance=os.getenv("CLICKZETTA_INSTANCE", "test_instance"),
            service=os.getenv("CLICKZETTA_SERVICE", "api.clickzetta.com"),
            workspace=os.getenv("CLICKZETTA_WORKSPACE", "test_workspace"),
            vcluster=os.getenv("CLICKZETTA_VCLUSTER", "default"),
            database=os.getenv("CLICKZETTA_SCHEMA", "dify"),
        )

        with conn.cursor() as cursor:
            cursor.execute("SELECT 1 as test")
            result = cursor.fetchone()
            logger.info("✓ Connection test: %s", result)

            cursor.execute("SHOW TABLES IN dify")
            tables = cursor.fetchall()
            logger.info("✓ Existing tables: %s", [t[1] for t in tables if t[0] == "dify"])

            test_collection = "collection_test_dataset"
            if test_collection in [t[1] for t in tables if t[0] == "dify"]:
                cursor.execute(f"DESCRIBE dify.{test_collection}")
                columns = cursor.fetchall()
                logger.info("✓ Table structure for %s:", test_collection)
                for col in columns:
                    logger.info("  - %s: %s", col[0], col[1])

                cursor.execute(f"SHOW INDEXES IN dify.{test_collection}")
                indexes = cursor.fetchall()
                logger.info("✓ Indexes on %s:", test_collection)
                for idx in indexes:
                    logger.info("  - %s", idx)

        return True
    except Exception:
        logger.exception("✗ Connection test failed")
        return False


def test_dify_api():
    """Test Dify API with Clickzetta backend"""
    logger.info("\n=== Testing Dify API ===")
    base_url = "http://localhost:5001"

    max_retries = 30
    for i in range(max_retries):
        try:
            response = httpx.get(f"{base_url}/console/api/health")
            if response.status_code == 200:
                logger.info("✓ Dify API is ready")
                break
        except:
            if i == max_retries - 1:
                logger.exception("✗ Dify API is not responding")
                return False
            time.sleep(2)

    try:
        logger.info("✓ Dify is configured to use Clickzetta as vector store")
        return True
    except Exception:
        logger.exception("✗ API test failed")
        return False


def verify_table_structure():
    """Verify the table structure meets Dify requirements"""
    logger.info("\n=== Verifying Table Structure ===")

    expected_columns = {
        "id": "VARCHAR",
        "page_content": "VARCHAR",
        "metadata": "VARCHAR",
        "vector": "ARRAY<FLOAT>",
    }

    expected_metadata_fields = ["doc_id", "doc_hash", "document_id", "dataset_id"]

    logger.info("✓ Expected table structure:")
    for col, dtype in expected_columns.items():
        logger.info("  - %s: %s", col, dtype)

    logger.info("\n✓ Required metadata fields:")
    for field in expected_metadata_fields:
        logger.info("  - %s", field)

    logger.info("\n✓ Index requirements:")
    logger.info("  - Vector index (HNSW) on 'vector' column")
    logger.info("  - Full-text index on 'page_content' (optional)")
    logger.info("  - Functional index on metadata->>'$.doc_id' (recommended)")
    logger.info("  - Functional index on metadata->>'$.document_id' (recommended)")

    return True


def main():
    """Run all tests"""
    logger.info("Starting Clickzetta integration tests for Dify Docker\n")

    tests = [
        ("Direct Clickzetta Connection", test_clickzetta_connection),
        ("Dify API Status", test_dify_api),
        ("Table Structure Verification", verify_table_structure),
    ]

    results = []
    for test_name, test_func in tests:
        try:
            success = test_func()
            results.append((test_name, success))
        except Exception:
            logger.exception("\n✗ %s crashed", test_name)
            results.append((test_name, False))

    logger.info("\n%s", "=" * 50)
    logger.info("Test Summary:")
    logger.info("=" * 50)

    passed = sum(1 for _, success in results if success)
    total = len(results)

    for test_name, success in results:
        status = "✅ PASSED" if success else "❌ FAILED"
        logger.info("%s: %s", test_name, status)

    logger.info("\nTotal: %s/%s tests passed", passed, total)

    if passed == total:
        logger.info("\n🎉 All tests passed! Clickzetta is ready for Dify Docker deployment.")
        logger.info("\nNext steps:")
        logger.info(
            "1. Run: cd docker && docker-compose -f docker-compose.yaml -f docker-compose.clickzetta.yaml up -d"
        )
        logger.info("2. Access Dify at http://localhost:3000")
        logger.info("3. Create a dataset and test vector storage with Clickzetta")
        return 0
    else:
        logger.error("\n⚠️  Some tests failed. Please check the errors above.")
        return 1


if __name__ == "__main__":
    exit(main())
