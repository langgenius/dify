"""
Document Priority Loader

Loads and manages document priority rules from CSV configuration.
Supports both exact string matching and regular expression patterns.
"""

import csv
import re
from pathlib import Path
from typing import Optional


class DocumentPriorityLoader:
    """Loads document priority rules from CSV configuration"""

    _rules_cache: Optional[list[dict]] = None
    _compiled_regex_cache: dict[str, re.Pattern] = {}

    @classmethod
    def load_rules(cls) -> list[dict]:
        """
        Load priority rules from CSV file.

        Returns:
            List of rule dictionaries with keys: 'pattern', 'boost', 'match_type'
        """
        if cls._rules_cache is not None:
            return cls._rules_cache

        rules = []
        config_path = Path(__file__).parent / "config" / "document_priority_rules.csv"

        if not config_path.exists():
            cls._rules_cache = []
            return []

        try:
            with config_path.open("r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    pattern = row.get("模式", "").strip()
                    boost_str = row.get("权重加成", "0").strip()
                    match_type = row.get("匹配类型", "普通").strip()

                    if not pattern:
                        continue

                    try:
                        boost = float(boost_str)
                    except ValueError:
                        continue

                    rule = {
                        "pattern": pattern,
                        "boost": boost,
                        "match_type": match_type,
                    }

                    # Pre-compile regex patterns (case-insensitive)
                    if match_type == "正则":
                        try:
                            cls._compiled_regex_cache[pattern] = re.compile(pattern, re.IGNORECASE)
                        except re.error:
                            continue  # Skip invalid regex patterns

                    rules.append(rule)

        except Exception:
            pass  # Fail silently, return empty rules

        cls._rules_cache = rules
        return rules

    @classmethod
    def get_priority_boost(cls, document_name: str) -> float:
        """
        Calculate the priority boost for a document name.
        Uses the maximum boost if multiple rules match.

        Args:
            document_name: Name of the document

        Returns:
            Boost value (0.0 if no match, higher values for priority matches)
        """
        if not document_name:
            return 0.0

        rules = cls.load_rules()
        if not rules:
            return 0.0

        max_boost = 0.0
        document_name_lower = document_name.lower()

        for rule in rules:
            pattern = rule["pattern"]
            boost = rule["boost"]
            match_type = rule["match_type"]

            matched = False

            if match_type == "正则":
                # Use pre-compiled regex (case-insensitive)
                regex = cls._compiled_regex_cache.get(pattern)
                if regex and regex.search(document_name):
                    matched = True
            else:
                # Exact substring match (case-insensitive)
                if pattern.lower() in document_name_lower:
                    matched = True

            if matched and boost > max_boost:
                max_boost = boost

        return max_boost

    @classmethod
    def clear_cache(cls):
        """Clear the cached rules (useful for testing or dynamic updates)"""
        cls._rules_cache = None
        cls._compiled_regex_cache = {}
