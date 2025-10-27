"""
Filter Rule Loader

Loads and manages document filtering rules from CSV configuration.
Uses structured entity extraction: base entities + attributes for precise filtering.
"""

import csv
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

logger = logging.getLogger("dify.rag.filter")


@dataclass
class EntityExtraction:
    """结构化实体提取结果"""

    base_entity: Optional[str]  # 基础实体，如 "e5q"（单实体模式）
    attributes: list[str]  # 属性列表，如 ["75寸", "黑色"]
    all_entities: list[str]  # 所有提取的实体列表（多实体模式），如 ["P20", "P20 Plus"]
    is_comparison: bool = False  # 是否为对比查询

    def matches(self, other: "EntityExtraction") -> bool:
        """
        判断是否匹配

        对比模式（查询包含多个实体）：
        - 文档实体匹配查询的任一实体即可

        普通模式（查询只有一个实体）：
        - 基础实体必须完全相同（大小写不敏感）
        - 或者查询实体是文档实体的缩写形式（如 "p20up" 匹配 "P20 Ultra Plus"）
        - 查询的所有属性必须在文档中存在（子集关系，支持模糊匹配）

        示例：
        - Query: [P20, P20 Plus] (对比模式)
          Doc:   P20  → ✓ PASS (匹配其中一个)

        - Query: e5q + [75寸]
          Doc:   e5q + [75寸, 黑色]  → ✓ PASS

        - Query: e5q + [75寸]
          Doc:   e5q + [75]  → ✓ PASS (数字模糊匹配)

        - Query: e5q + [75寸]
          Doc:   e5q + [65寸]  → ✗ FAIL

        - Query: p20up
          Doc:   P20 Ultra Plus  → ✓ PASS (缩写匹配)
        """
        if not self.base_entity or not other.base_entity:
            return True  # 无实体时不过滤

        # 对比模式：文档实体匹配任一查询实体即可
        if self.is_comparison and self.all_entities:
            doc_entity_lower = other.base_entity.lower()
            return any(query_entity.lower() == doc_entity_lower for query_entity in self.all_entities)

        # 普通模式：基础实体必须匹配（大小写不敏感）或缩写匹配
        query_lower = self.base_entity.lower()
        doc_lower = other.base_entity.lower()

        # 1. 完全匹配
        if query_lower == doc_lower:
            # 查询属性必须是文档属性的子集（支持模糊匹配）
            return self._attributes_match(self.attributes, other.attributes)

        # 2. 检查缩写匹配（查询是否是文档的缩写）
        if self._is_abbreviation_match(query_lower, doc_lower):
            # 缩写匹配时，查询属性也必须满足
            return self._attributes_match(self.attributes, other.attributes)

        # 3. 检查反向缩写匹配（文档是否是查询的缩写）
        if self._is_abbreviation_match(doc_lower, query_lower):
            return self._attributes_match(self.attributes, other.attributes)

        return False

    @staticmethod
    def _attributes_match(query_attrs: list[str], doc_attrs: list[str]) -> bool:
        """
        Check if query attributes match document attributes.

        Supports fuzzy matching for numeric attributes:
        - "75" (in doc) matches "75寸" (in query)
        - "8" (in doc) matches "8GB" (in query)

        Args:
            query_attrs: Query attribute list
            doc_attrs: Document attribute list

        Returns:
            True if all query attributes match document attributes
        """
        if not query_attrs:
            return True  # No query attributes to match

        # Normalize attributes (lowercase)
        query_attrs_lower = [attr.lower() for attr in query_attrs]
        doc_attrs_lower = [attr.lower() for attr in doc_attrs]

        # Check if each query attribute has a match in document attributes
        for query_attr in query_attrs_lower:
            matched = False
            match_type = None
            matched_doc_attr = None

            # Try exact match first
            if query_attr in doc_attrs_lower:
                matched = True
                match_type = "exact"
                matched_doc_attr = query_attr
            else:
                # Try fuzzy match: extract numeric part and compare
                query_num = EntityExtraction._extract_number(query_attr)
                if query_num:
                    # Query has a number - check if any doc attribute has the same number
                    for doc_attr in doc_attrs_lower:
                        doc_num = EntityExtraction._extract_number(doc_attr)
                        if doc_num == query_num:
                            matched = True
                            match_type = "fuzzy"
                            matched_doc_attr = doc_attr
                            break

            if not matched:
                logger.info(
                    "[FILTER_LOADER] ✗ No match: query attribute '%s' not found in doc attributes %s",
                    query_attr,
                    doc_attrs_lower,
                )
                return False

        return True

    @staticmethod
    def _extract_number(attr: str) -> Optional[str]:
        """
        Extract the numeric part from an attribute.

        Examples:
        - "75寸" → "75"
        - "8GB" → "8"
        - "黑色" → None
        - "75" → "75"

        Args:
            attr: Attribute string

        Returns:
            Numeric part or None
        """
        import re

        match = re.search(r"^\d+", attr)
        return match.group(0) if match else None

    @staticmethod
    def _is_abbreviation_match(abbrev: str, full: str) -> bool:
        """
        检查 abbrev 是否是 full 的缩写形式

        例如：
        - "p20up" 是 "p20 ultra plus" 的缩写 (p20 + u + p)
        - "p20u" 是 "p20 ultra" 的缩写 (p20 + u)
        - "t80" 不是 "t80s" 的缩写

        Args:
            abbrev: 缩写形式（小写）
            full: 完整形式（小写）

        Returns:
            True if abbrev is an abbreviation of full
        """
        # 移除空格
        full_no_space = full.replace(" ", "")
        abbrev_no_space = abbrev.replace(" ", "")

        # 如果缩写比完整形式长或相等，不可能是缩写
        if len(abbrev_no_space) >= len(full_no_space):
            return False

        # 将完整形式按空格分割成单词
        words = full.split()
        if len(words) <= 1:
            # 只有一个单词，直接检查是否为前缀
            return full_no_space.startswith(abbrev_no_space)

        # 多单词情况：检查缩写模式
        # 例如：p20 ultra plus -> p20up, p20u, p20 u, etc.

        # 尝试匹配：第一个单词 + 后续单词的首字母
        first_word = words[0]
        rest_words = words[1:]

        # 检查缩写是否以第一个单词开头
        if not abbrev_no_space.startswith(first_word):
            return False

        # 获取第一个单词后面的部分
        after_first = abbrev_no_space[len(first_word) :]

        # 如果缩写恰好等于第一个单词，且还有后续单词，则不是缩写（例如 "e5q" vs "e5q pro"）
        if not after_first and rest_words:
            return False

        # 情况1：完全匹配（如 "p20ultraplus" 匹配 "p20 ultra plus"）
        expected_full = "".join(words)
        if abbrev_no_space == expected_full:
            return True

        # 情况2：首字母缩写（如 "p20up" 匹配 "p20 ultra plus"）
        # 检查剩余部分是否匹配后续单词的首字母
        if len(after_first) == len(rest_words):
            # 每个字符应该匹配对应单词的首字母
            return all(char == rest_words[i][0] for i, char in enumerate(after_first))

        # 情况3：部分缩写（如 "p20u" 匹配 "p20 ultra plus"）
        # 检查是否匹配前N个单词的首字母
        if len(after_first) < len(rest_words) and after_first:
            return all(char == rest_words[i][0] for i, char in enumerate(after_first))

        # 情况4：混合形式（如 "p20ultra" 匹配 "p20 ultra plus"）
        # 检查是否匹配部分完整单词
        remaining = after_first
        for word in rest_words:
            if remaining.startswith(word):
                # 完整单词匹配
                remaining = remaining[len(word) :]
            elif remaining and remaining[0] == word[0]:
                # 首字母匹配
                remaining = remaining[1:]
            else:
                # 不匹配
                return False

            if not remaining:
                # 已经匹配完了
                return True

        return not remaining  # 如果remaining为空，说明完全匹配


class FilterRuleLoader:
    """Loads filter rules from CSV configuration and performs structured entity-based filtering"""

    _rules_cache: Optional[list[dict]] = None
    _base_entity_patterns: Optional[list[tuple[str, re.Pattern]]] = None  # Base entities
    _attribute_patterns: Optional[list[tuple[str, str, re.Pattern]]] = None  # (attr, type, pattern)
    _base_entities: Optional[list[str]] = None
    _attributes: Optional[dict[str, str]] = None  # attr -> type

    @classmethod
    def load_rules(cls) -> list[dict]:
        """
        Load structured entity dictionary from CSV file.

        CSV Format:
        实体,属性类型
        e5q,
        75寸,尺寸

        Returns:
            List of rule dictionaries (for compatibility)
        """
        if cls._rules_cache is not None:
            return cls._rules_cache

        base_entities = []
        attributes = {}  # attr_name -> attr_type
        config_path = Path(__file__).parent / "config" / "filter_rules.csv"

        if not config_path.exists():
            cls._rules_cache = []
            return []

        try:
            with config_path.open("r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    entity_name = row.get("实体", "").strip()
                    attr_type = row.get("属性类型", "").strip()

                    if not entity_name:
                        continue

                    if attr_type:
                        # This is an attribute
                        attributes[entity_name] = attr_type
                    else:
                        # This is a base entity
                        base_entities.append(entity_name)

        except Exception:
            logger.exception("[FILTER_LOADER] Failed to load rules")
            return []

        # Sort by length (longest first for longest match)
        base_entities.sort(key=len, reverse=True)
        attribute_names = sorted(attributes.keys(), key=len, reverse=True)

        # Build patterns
        cls._base_entities = base_entities
        cls._attributes = attributes
        cls._base_entity_patterns = cls._build_patterns(base_entities)
        cls._attribute_patterns = cls._build_attribute_patterns(attribute_names, attributes)

        # Build rules cache for compatibility
        rules = [{"entity": e} for e in base_entities]
        cls._rules_cache = rules

        logger.info("[FILTER_LOADER] Loaded %d base entities, %d attributes", len(base_entities), len(attributes))
        return rules

    @classmethod
    def _build_patterns(cls, entities: list[str]) -> list[tuple[str, re.Pattern]]:
        """
        Build regex patterns for entity list.

        Args:
            entities: List of entity names (already sorted by length)

        Returns:
            List of (entity, compiled_pattern) tuples
        """
        patterns = []

        for entity in entities:
            # Build pattern that matches the entity
            # Support both "P20 Plus" and "P20Plus" (with/without space)
            if " " in entity:
                # Has space: create pattern matching both forms
                parts = entity.split(" ")
                base = re.escape(parts[0])

                # For multi-word entities, match with optional spaces and abbreviations
                rest_patterns = []
                for part in parts[1:]:
                    escaped_part = re.escape(part)
                    # Match: " Plus" or "Plus" (no space) or "+" (abbreviation)
                    # Use word boundary to prevent partial matches like "p20u" matching "P20 Ultra"
                    abbrev = cls._get_abbreviation(part)
                    if abbrev:
                        # For abbreviations: support optional space + (full word OR abbreviation with boundary)
                        # Require word boundary after abbreviation to avoid matching "p20u" as "P20 Ultra"
                        rest_patterns.append(f"(?:\\s*{escaped_part}|\\s*{re.escape(abbrev)}(?![a-z0-9]))")
                    else:
                        rest_patterns.append(f"(?:\\s*{escaped_part})")

                # Match entity with boundaries (not preceded/followed by alphanumeric)
                pattern_str = rf"{base}{''.join(rest_patterns)}"
            else:
                # Simple entity without spaces - add word boundary at the end
                pattern_str = rf"{re.escape(entity)}(?![a-zA-Z0-9])"

            try:
                # Case-insensitive matching for flexibility
                pattern = re.compile(pattern_str, re.IGNORECASE)
                patterns.append((entity, pattern))
            except re.error as e:
                logger.warning("[FILTER_LOADER] Failed to compile pattern for '%s': %s", entity, e)

        return patterns

    @classmethod
    def _build_attribute_patterns(
        cls, attr_names: list[str], attr_map: dict[str, str]
    ) -> list[tuple[str, str, re.Pattern]]:
        """
        Build regex patterns for attributes.

        Args:
            attr_names: List of attribute names (sorted by length)
            attr_map: Dict mapping attr_name -> attr_type

        Returns:
            List of (attr_name, attr_type, compiled_pattern) tuples
        """
        patterns = []

        for attr_name in attr_names:
            attr_type = attr_map[attr_name]

            # Build pattern similar to entity patterns
            if " " in attr_name:
                parts = attr_name.split(" ")
                base = re.escape(parts[0])
                rest_patterns = []
                for part in parts[1:]:
                    escaped_part = re.escape(part)
                    abbrev = cls._get_abbreviation(part)
                    if abbrev:
                        rest_patterns.append(f"(?:\\s*{escaped_part}|\\s*{re.escape(abbrev)})")
                    else:
                        rest_patterns.append(f"(?:\\s*{escaped_part})")
                pattern_str = rf"{base}{''.join(rest_patterns)}"
            else:
                pattern_str = rf"{re.escape(attr_name)}"

            try:
                pattern = re.compile(pattern_str, re.IGNORECASE)
                patterns.append((attr_name, attr_type, pattern))
            except re.error as e:
                logger.warning("[FILTER_LOADER] Failed to compile attribute pattern for '%s': %s", attr_name, e)

        return patterns

    @classmethod
    def _get_abbreviation(cls, word: str) -> Optional[str]:
        """
        Get common abbreviation for a word.

        Args:
            word: Word to abbreviate

        Returns:
            Abbreviation or None
        """
        abbrev_map = {
            "plus": "+",
            "Plus": "+",
            "PLUS": "+",
            "pro": "P",
            "Pro": "P",
            "PRO": "P",
            "ultra": "U",
            "Ultra": "U",
            "ULTRA": "U",
        }
        return abbrev_map.get(word)

    @classmethod
    def _is_comparison_query(cls, query: str) -> bool:
        """
        Check if query is a comparison query.

        Comparison indicators:
        - 和 (and)
        - 与 (with)
        - 区别 (difference)
        - 对比 (compare)
        - 比较 (compare)
        - vs
        - versus

        Args:
            query: User query text

        Returns:
            True if comparison query, False otherwise
        """
        comparison_keywords = [
            "和",
            "与",
            "区别",
            "对比",
            "比较",
            "vs",
            "versus",
            "VS",
            "Versus",
            "还是",
            "或者",
            "哪个好",
        ]

        query_lower = query.lower()
        return any(keyword.lower() in query_lower for keyword in comparison_keywords)

    @classmethod
    def extract_structured_entity(cls, text: str, extract_all_entities: bool = False) -> EntityExtraction:
        """
        Extract structured entity (base entity + attributes) from text.

        Enhanced logic:
        1. Extract base entity (or all entities if extract_all_entities=True)
        2. Extract explicit attributes (e.g., "75寸", "黑色")
        3. Extract numbers around base entity and infer attributes (e.g., "75" near "e5q" → "75寸")

        Args:
            text: Text to extract from
            extract_all_entities: If True, extract all entities (for comparison queries)

        Returns:
            EntityExtraction with base_entity and attributes
        """
        if not text:
            return EntityExtraction(base_entity=None, attributes=[], all_entities=[], is_comparison=False)

        # Load patterns if not loaded
        if cls._base_entity_patterns is None:
            cls.load_rules()

        # Check if this is a comparison query
        is_comparison = cls._is_comparison_query(text) if extract_all_entities else False

        # Extract entities
        all_entities = []
        entity_spans = []

        if cls._base_entity_patterns:
            if extract_all_entities:
                # Extract ALL matching entities (for comparison queries)
                seen_positions = set()
                for entity, pattern in cls._base_entity_patterns:
                    match = pattern.search(text)
                    if match:
                        start, end = match.span()
                        # Avoid overlapping matches
                        if not any(pos in seen_positions for pos in range(start, end)):
                            all_entities.append(entity)
                            entity_spans.append((start, end))
                            seen_positions.update(range(start, end))
            else:
                # Extract single entity with best match (prefer exact/longer matches)
                # Collect all potential matches and score them
                candidates = []  # (entity, match_obj, score, start, end)
                for entity, pattern in cls._base_entity_patterns:
                    match = pattern.search(text)
                    if match:
                        start, end = match.span()
                        matched_length = end - start
                        entity_length = len(entity)
                        matched_text = text[start:end]

                        # Check for exact match (consider both with and without spaces)
                        # 1. Matched text == entity (exact, with spaces preserved)
                        # 2. Matched text == entity without spaces (variant form like "P20Ultra" for "P20 Ultra")
                        entity_no_space = entity.replace(" ", "").lower()
                        matched_no_space = matched_text.replace(" ", "").lower()
                        is_exact = (matched_text.lower() == entity.lower()) or (matched_no_space == entity_no_space)

                        # Scoring:
                        # - Exact match gets highest priority (score +1000)
                        # - Prefer longer matches (matched_length bonus)
                        # - Penalize length mismatch from entity
                        score = (1000 if is_exact else 0) + matched_length - abs(matched_length - entity_length)
                        candidates.append((entity, match, score, start, end))

                # Remove overlapping candidates: for overlapping matches, keep only the longest one
                if candidates:
                    # Sort by score (descending), then by length (descending)
                    candidates.sort(key=lambda x: (x[2], x[4] - x[3]), reverse=True)
                    
                    # Filter out overlapping candidates
                    non_overlapping = []
                    used_positions = set()
                    
                    for entity, match, score, start, end in candidates:
                        # Check if this candidate overlaps with any already selected
                        if not any(pos in used_positions for pos in range(start, end)):
                            non_overlapping.append((entity, match, score))
                            used_positions.update(range(start, end))
                    
                    if non_overlapping:
                        best_entity, best_match, best_score = non_overlapping[0]
                        all_entities = [best_entity]
                        entity_spans = [best_match.span()]

        # Use the first entity as base_entity (for backward compatibility)
        base_entity = all_entities[0] if all_entities else None
        base_entity_span = entity_spans[0] if entity_spans else None

        # Extract all attributes (multiple, position-deduplicated)
        attributes = []
        covered_positions = set()

        if cls._attribute_patterns:
            matches = []  # (start, end, attr_name)
            for attr_name, attr_type, pattern in cls._attribute_patterns:
                for match in pattern.finditer(text):
                    start, end = match.span()
                    matches.append((start, end, attr_name))

            # Deduplicate by position
            if matches:
                matches.sort(key=lambda x: (x[0], -(x[1] - x[0])))
                for start, end, attr_name in matches:
                    overlap = any(pos in covered_positions for pos in range(start, end))
                    if not overlap:
                        attributes.append(attr_name)
                        covered_positions.update(range(start, end))

        # Enhanced: Extract numbers around base entity and infer attributes
        if base_entity and base_entity_span:
            inferred_attrs = cls._infer_attributes_from_numbers(text, base_entity_span, covered_positions)
            attributes.extend(inferred_attrs)

        result = EntityExtraction(
            base_entity=base_entity, attributes=attributes, all_entities=all_entities, is_comparison=is_comparison
        )
        logger.info(
            "[FILTER_LOADER] Extracted from text: base='%s', attrs=%s, all_entities=%s, is_comparison=%s",
            base_entity,
            attributes,
            all_entities,
            is_comparison,
        )
        return result

    @classmethod
    def _infer_attributes_from_numbers(
        cls, text: str, entity_span: tuple[int, int], covered_positions: set
    ) -> list[str]:
        """
        Infer attributes from numbers around the base entity.

        Examples:
        - "75e5q" → entity_span=(2,5), number "75" at (0,2) → "75寸"
        - "e5q75" → entity_span=(0,3), number "75" at (3,5) → "75寸"
        - "e5q 8 12" → numbers "8", "12" → "8GB", "12GB"

        Args:
            text: Full text
            entity_span: (start, end) position of base entity
            covered_positions: Already covered positions by explicit attributes

        Returns:
            List of inferred attribute names
        """
        if not cls._attributes:
            return []

        inferred = []
        entity_start, entity_end = entity_span

        # Extract numbers before and after entity
        # Pattern: look for numbers around entity (within 5 chars distance)
        search_before = text[max(0, entity_start - 10) : entity_start]
        search_after = text[entity_end : min(len(text), entity_end + 10)]

        # Find all numbers
        number_pattern = re.compile(r"\d+")

        # Check numbers before entity
        for match in number_pattern.finditer(search_before):
            number = match.group(0)
            # Calculate actual position in full text
            actual_start = max(0, entity_start - 10) + match.start()
            actual_end = max(0, entity_start - 10) + match.end()

            # Skip if already covered
            if any(pos in covered_positions for pos in range(actual_start, actual_end)):
                continue

            # Try to infer attribute
            attr = cls._infer_attribute_from_number(number)
            if attr:
                inferred.append(attr)
                logger.info("[FILTER_LOADER] Inferred attribute '%s' from number '%s' before entity", attr, number)

        # Check numbers after entity
        for match in number_pattern.finditer(search_after):
            number = match.group(0)
            # Calculate actual position in full text
            actual_start = entity_end + match.start()
            actual_end = entity_end + match.end()

            # Skip if already covered
            if any(pos in covered_positions for pos in range(actual_start, actual_end)):
                continue

            # Try to infer attribute
            attr = cls._infer_attribute_from_number(number)
            if attr:
                inferred.append(attr)
                logger.info("[FILTER_LOADER] Inferred attribute '%s' from number '%s' after entity", attr, number)

        return inferred

    @classmethod
    def _infer_attribute_from_number(cls, number: str) -> Optional[str]:
        """
        Infer full attribute name from a number.

        Logic:
        - Try common suffixes: "寸", "GB", "TB"
        - Check if "{number}{suffix}" exists in attribute dictionary

        Args:
            number: String number like "75", "8", "512"

        Returns:
            Full attribute name or None
        """
        if not cls._attributes:
            return None

        # Try common suffixes by attribute type
        type_suffixes = {
            "尺寸": ["寸"],
            "内存": ["GB"],
            "存储": ["GB", "TB"],
        }

        # Try each suffix
        for attr_name, attr_type in cls._attributes.items():
            if attr_type in type_suffixes:
                for suffix in type_suffixes[attr_type]:
                    candidate = f"{number}{suffix}"
                    if candidate == attr_name:
                        return attr_name

        return None

    @classmethod
    def extract_entity(cls, text: str) -> Optional[str]:
        """
        Extract base entity only (for backward compatibility).

        Args:
            text: Text to extract entity from

        Returns:
            Base entity name or None
        """
        extraction = cls.extract_structured_entity(text)
        return extraction.base_entity

    @classmethod
    def extract_all_entities(cls, text: str) -> list[str]:
        """
        Extract ALL base entities from text (for backward compatibility).
        Note: For structured extraction, use extract_structured_entity() instead.

        Args:
            text: Text to extract entities from

        Returns:
            List of all extracted base entity names
        """
        if not text:
            return []

        # Load patterns if not loaded
        if cls._base_entity_patterns is None:
            cls.load_rules()

        if not cls._base_entity_patterns:
            return []

        # Find all matches with their positions
        matches = []  # List of (start, end, entity)

        for entity, pattern in cls._base_entity_patterns:
            for match in pattern.finditer(text):
                start, end = match.span()
                matches.append((start, end, entity))

        if not matches:
            return []

        # Sort by start position, then by length (longer first)
        matches.sort(key=lambda x: (x[0], -(x[1] - x[0])))

        # Remove overlapping matches (keep longer/earlier ones)
        selected_matches = []
        covered_positions = set()

        for start, end, entity in matches:
            # Check if this match overlaps with any already selected
            overlap = any(pos in covered_positions for pos in range(start, end))
            if not overlap:
                selected_matches.append(entity)
                covered_positions.update(range(start, end))

        return selected_matches

    @classmethod
    def get_applicable_rules(cls, query: str) -> EntityExtraction:
        """
        Extract structured entity from query.

        For comparison queries (containing "和", "区别", etc.), extracts all entities.
        For normal queries, extracts only the longest matching entity.

        Args:
            query: User query text

        Returns:
            EntityExtraction object with base entity and attributes
        """
        # Check if this is a comparison query and extract accordingly
        is_comparison = cls._is_comparison_query(query)
        extraction = cls.extract_structured_entity(query, extract_all_entities=is_comparison)

        return extraction

    @classmethod
    def should_filter_out(cls, content: str, query_extraction: EntityExtraction) -> tuple[bool, Optional[str]]:
        """
        Check if content should be filtered out based on structured entity matching.

        Logic:
        - Extract structured entity from document content
        - Match using EntityExtraction.matches() method
        - Filter out if not matched

        Args:
            content: Document content to check
            query_extraction: Query's EntityExtraction object

        Returns:
            Tuple of (should_filter, reason)
        """
        if not content:
            return False, None

        if not query_extraction.base_entity:
            # No base entity in query, don't filter
            return False, None

        # Extract structured entity from document
        doc_extraction = cls.extract_structured_entity(content)

        if not doc_extraction.base_entity:
            # Document has no recognized entity, filter it out
            return True, f"文档无法识别实体（查询: {query_extraction.base_entity}）"

        # Check if match
        if query_extraction.matches(doc_extraction):
            # Log successful match for debugging
            logger.info(
                "[FILTER_LOADER] ✓ Match: doc=%s%s vs query=%s%s",
                doc_extraction.base_entity.upper(),
                doc_extraction.attributes,
                query_extraction.base_entity.upper(),
                query_extraction.attributes,
            )
            return False, None

        # No match - generate reason
        logger.info(
            "[FILTER_LOADER] ✗ No match: doc=%s%s vs query=%s%s",
            doc_extraction.base_entity.upper(),
            doc_extraction.attributes,
            query_extraction.base_entity.upper(),
            query_extraction.attributes,
        )

        if query_extraction.is_comparison:
            reason = (
                f"对比模式：文档实体 '{doc_extraction.base_entity}' 不在查询实体列表中 {query_extraction.all_entities}"
            )
        else:
            # Generate detailed reason
            if doc_extraction.base_entity.lower() != query_extraction.base_entity.lower():
                reason = f"基础实体不匹配（文档: {doc_extraction.base_entity}, 查询: {query_extraction.base_entity}）"
            else:
                missing_attrs = set(query_extraction.attributes) - set(doc_extraction.attributes)
                reason = f"属性不匹配（文档缺少: {', '.join(missing_attrs)}）"

        return True, reason

    @classmethod
    def clear_cache(cls):
        """Clear the cached rules and patterns"""
        cls._rules_cache = None
        cls._base_entity_patterns = None
        cls._attribute_patterns = None
        cls._base_entities = None
        cls._attributes = None
