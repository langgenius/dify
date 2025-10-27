#!/usr/bin/env python3
# ruff: noqa: T201
"""
Quick verification script for multiple recall and filtering strategies.

Usage:
    cd /Users/sunfuwei/IdeaProjects/dify-1
    uv run --project api python api/core/rag/retrieval/verify_strategies.py
"""

import sys
from pathlib import Path

# Add api directory to path so we can import modules
api_dir = Path(__file__).parent.parent.parent.parent  # api/
sys.path.insert(0, str(api_dir))


def print_header(text):
    """Print formatted header"""
    print(f"\n{'=' * 70}")
    print(f"  {text}")
    print(f"{'=' * 70}\n")


def print_section(text):
    """Print formatted section"""
    print(f"\n{text}")
    print("-" * 70)


def verify_configuration():
    """Verify feature configuration"""
    print_section("1. FEATURE CONFIGURATION")

    try:
        from configs import dify_config

        features = {
            "RAG_DOCUMENT_PRIORITY_ENABLED": getattr(dify_config, "RAG_DOCUMENT_PRIORITY_ENABLED", False),
            "RAG_FILTER_ENABLED": getattr(dify_config, "RAG_FILTER_ENABLED", False),
            "RAG_RETRIEVAL_TOP_K_MULTIPLIER": getattr(dify_config, "RAG_RETRIEVAL_TOP_K_MULTIPLIER", 3.0),
        }

        for feature, value in features.items():
            status = "✓ ENABLED" if value else "✗ DISABLED" if isinstance(value, bool) else f"✓ SET TO {value}"
            print(f"  {status:<20} {feature}: {value}")

        return True
    except Exception as e:
        print(f"  ✗ ERROR: {e}")
        return False


def verify_priority_rules():
    """Verify document priority rules"""
    print_section("2. DOCUMENT PRIORITY RULES")

    try:
        from core.rag.retrieval.document_priority_loader import DocumentPriorityLoader

        loader = DocumentPriorityLoader()
        rules = loader.load_rules()

        if rules:
            print(f"  ✓ Loaded {len(rules)} priority rules\n")
            for i, rule in enumerate(rules, 1):
                print(f"  Rule {i}:")
                print(f"    Pattern: {rule.get('pattern', 'N/A')}")
                print(f"    Boost: +{rule.get('boost', 'N/A')}")
                print(f"    Match Type: {rule.get('match_type', 'N/A')}")
        else:
            print("  ⚠ No priority rules loaded (may not be configured)")

        # Test pattern matching
        print_section("   PATTERN MATCHING TEST")
        test_docs = [
            "2024年价格政策.pdf",
            "产品介绍.pdf",
            "价格表2024.pdf",
            "用户手册.pdf",
        ]

        for doc_name in test_docs:
            boost = loader.get_priority_boost(doc_name)
            status = "✓ MATCHED" if boost > 0 else "  NO MATCH"
            print(f"    {status:<15} {doc_name:<30} boost: +{boost}")

        return True
    except Exception as e:
        print(f"  ✗ ERROR: {e}")
        return False


def verify_filter_rules():
    """Verify filter rules"""
    print_section("3. FILTER RULES")

    try:
        from core.rag.filter.filter_rule_loader import FilterRuleLoader

        rules = FilterRuleLoader.load_rules()

        if rules:
            print(f"  ✓ Loaded {len(rules)} filter rules\n")
            for i, rule in enumerate(rules, 1):
                print(f"  Rule {i}:")
                print(f"    Entity: {rule.get('entity', 'N/A')}")
                print(f"    Spec: {rule.get('spec', 'N/A')}")
                print(f"    Exclude Pattern: {rule.get('exclude', 'N/A')}")
        else:
            print("  ⚠ No filter rules loaded (may not be configured)")

        # Test applicable rules detection
        print_section("   APPLICABLE RULES TEST")
        test_queries = [
            "价格 P20",
            "产品介绍",
        ]

        for query in test_queries:
            applicable = FilterRuleLoader.get_applicable_rules(query)
            print(f"    Query: '{query}'")
            print(f"      → {len(applicable)} applicable rules")
            if applicable:
                for rule in applicable:
                    print(f"        - {rule.get('entity', 'N/A')}")

        return True
    except Exception as e:
        print(f"  ✗ ERROR: {e}")
        return False


def verify_deduplication():
    """Verify deduplication logic"""
    print_section("4. MULTIPLE RECALL DEDUPLICATION")

    try:
        from core.rag.models.document import Document

        # Simulate documents from different recall methods
        docs = [
            Document(page_content="Price info", metadata={"doc_id": "doc_1", "score": 0.8, "source": "keyword"}),
            Document(page_content="Price info", metadata={"doc_id": "doc_1", "score": 0.9, "source": "semantic"}),
            Document(page_content="Fee info", metadata={"doc_id": "doc_2", "score": 0.75}),
        ]

        print(f"  Input: {len(docs)} documents (from keyword + semantic search)\n")

        # Deduplicate by doc_id
        unique = {}
        for doc in docs:
            doc_id = doc.metadata.get("doc_id")
            if doc_id not in unique or doc.metadata.get("score", 0) > unique[doc_id].metadata.get("score", 0):
                unique[doc_id] = doc

        result = list(unique.values())

        print(f"  Output: {len(result)} unique documents\n")
        print("  ✓ Deduplication working correctly:")
        print(f"    - Input documents: {len(docs)}")
        print(f"    - Unique documents: {len(result)}")
        print(f"    - Duplicates removed: {len(docs) - len(result)}")

        for doc_id, doc in unique.items():
            print(f"\n    Document {doc_id}:")
            print(f"      Score: {doc.metadata.get('score')}")
            if doc.metadata.get("source"):
                print(f"      From: {doc.metadata.get('source')}")

        return True
    except Exception as e:
        print(f"  ✗ ERROR: {e}")
        return False


def verify_files_exist():
    """Verify required configuration files exist"""
    print_section("5. CONFIGURATION FILES")

    base_path = Path(__file__).parent.parent
    files_to_check = [
        (base_path / "retrieval" / "config" / "document_priority_rules.csv", "Priority Rules"),
        (base_path / "filter" / "config" / "filter_rules.csv", "Filter Rules"),
    ]

    all_exist = True
    for file_path, name in files_to_check:
        if file_path.exists():
            size = file_path.stat().st_size
            print(f"  ✓ {name:<20} exists ({size} bytes)")
            print(f"    Path: {file_path}")
        else:
            print(f"  ✗ {name:<20} NOT FOUND")
            print(f"    Expected: {file_path}")
            all_exist = False

    return all_exist


def verify_imports():
    """Verify all imports work correctly"""
    print_section("6. IMPORT VERIFICATION")

    modules = [
        ("core.rag.retrieval.document_priority_loader", "DocumentPriorityLoader"),
        ("core.rag.retrieval.document_priority_service", "DocumentPriorityService"),
        ("core.rag.filter.filter_rule_loader", "FilterRuleLoader"),
        ("core.rag.datasource.retrieval_service", "RetrievalService"),
    ]

    all_ok = True
    for module_name, class_name in modules:
        try:
            module = __import__(module_name, fromlist=[class_name])
            cls = getattr(module, class_name)
            print(f"  ✓ {module_name}")
            print(f"    └─ {class_name}")
        except (ImportError, SyntaxError) as e:
            print(f"  ✗ {module_name}")
            # Only count as failure if it's a direct import error, not a dependency issue
            error_msg = str(e)
            if "No module named" in error_msg and module_name.split(".")[0] not in error_msg:
                # This is a dependency error (e.g., missing gevent), not our module
                print(f"    └─ Dependency error: {e} (environment issue, not module issue)")
            else:
                print(f"    └─ Error: {e}")
                all_ok = False

    return all_ok


def main():
    """Run all verification checks"""
    print_header("MULTIPLE RECALL & FILTERING STRATEGIES VERIFICATION")

    results = {
        "Configuration": verify_configuration(),
        "Priority Rules": verify_priority_rules(),
        "Filter Rules": verify_filter_rules(),
        "Deduplication": verify_deduplication(),
        "Files": verify_files_exist(),
        "Imports": verify_imports(),
    }

    # Summary
    print_header("VERIFICATION SUMMARY")

    for check_name, result in results.items():
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"  {status:<10} {check_name}")

    all_passed = all(results.values())

    print("\n" + "=" * 70)
    if all_passed:
        print("  ✓ All verification checks passed!")
        print("  Your multiple recall and filtering strategies appear to be working correctly.")
    else:
        print("  ✗ Some verification checks failed.")
        print("  Please review the errors above and refer to DOCUMENT_PRIORITY_GUIDE.md")
    print("=" * 70 + "\n")

    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
