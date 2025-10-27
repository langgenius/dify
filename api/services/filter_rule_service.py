"""
Filter Rule Service

Business logic for managing filter rules (entities and attributes).
Handles CRUD operations on the filter_rules.csv configuration file.
"""

import csv
import logging
import os
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class FilterEntity:
    """Filter entity or attribute"""

    name: str  # Entity or attribute name
    attribute_type: Optional[str] = None  # Empty for base entities, type for attributes (尺寸, 颜色, etc.)

    def to_dict(self) -> dict:
        return {"name": self.name, "attribute_type": self.attribute_type or ""}

    def is_base_entity(self) -> bool:
        """Check if this is a base entity (not an attribute)"""
        return not self.attribute_type


@dataclass
class FilterRulesData:
    """Complete filter rules data"""

    entities: list[FilterEntity]  # Base entities (attribute_type is empty)
    attributes: list[FilterEntity]  # Attributes (attribute_type is not empty)

    def to_dict(self) -> dict:
        return {
            "entities": [e.to_dict() for e in self.entities],
            "attributes": [a.to_dict() for a in self.attributes],
        }

    @staticmethod
    def from_dict(data: dict) -> "FilterRulesData":
        entities = [
            FilterEntity(name=e["name"], attribute_type=e.get("attribute_type") or None)
            for e in data.get("entities", [])
        ]
        attributes = [
            FilterEntity(name=a["name"], attribute_type=a.get("attribute_type") or None)
            for a in data.get("attributes", [])
        ]
        return FilterRulesData(entities=entities, attributes=attributes)


class FilterRuleService:
    """Service for managing filter rules"""

    CSV_HEADERS = ["实体", "属性类型"]

    @classmethod
    def get_csv_path(cls) -> Path:
        """Get the path to filter_rules.csv"""
        return Path(__file__).parent.parent / "core" / "rag" / "filter" / "config" / "filter_rules.csv"

    @classmethod
    def get_all_rules(cls) -> FilterRulesData:
        """
        Read all filter rules from CSV.

        Returns:
            FilterRulesData with separated entities and attributes
        """
        csv_path = cls.get_csv_path()

        if not csv_path.exists():
            logger.warning("[FILTER_RULE_SERVICE] CSV file not found: %s", csv_path)
            return FilterRulesData(entities=[], attributes=[])

        entities = []
        attributes = []

        try:
            with csv_path.open("r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    entity_name = row.get("实体", "").strip()
                    attr_type = row.get("属性类型", "").strip()

                    if not entity_name:
                        continue

                    entity = FilterEntity(name=entity_name, attribute_type=attr_type or None)

                    if entity.is_base_entity():
                        entities.append(entity)
                    else:
                        attributes.append(entity)

            logger.info(
                "[FILTER_RULE_SERVICE] Loaded %d entities, %d attributes from CSV", len(entities), len(attributes)
            )
            return FilterRulesData(entities=entities, attributes=attributes)

        except Exception:
            logger.exception("[FILTER_RULE_SERVICE] Failed to load rules from CSV")
            return FilterRulesData(entities=[], attributes=[])

    @classmethod
    def update_rules(cls, rules_data: FilterRulesData) -> bool:
        """
        Update filter rules by writing to CSV.

        Args:
            rules_data: Complete filter rules data

        Returns:
            True if successful, False otherwise
        """
        csv_path = cls.get_csv_path()

        try:
            # Backup current CSV file
            cls._backup_csv()

            # Combine entities and attributes for CSV
            all_items = []
            all_items.extend(rules_data.entities)
            all_items.extend(rules_data.attributes)

            # Write to CSV
            with csv_path.open("w", encoding="utf-8", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=cls.CSV_HEADERS)
                writer.writeheader()

                for item in all_items:
                    writer.writerow({"实体": item.name, "属性类型": item.attribute_type or ""})

            logger.info(
                "[FILTER_RULE_SERVICE] Updated CSV with %d entities, %d attributes",
                len(rules_data.entities),
                len(rules_data.attributes),
            )

            # Clear cache to reload rules
            cls._clear_cache()

            return True

        except Exception:
            logger.exception("[FILTER_RULE_SERVICE] Failed to update CSV")
            return False

    @classmethod
    def add_entity(cls, name: str, attribute_type: Optional[str] = None) -> bool:
        """
        Add a new entity or attribute.

        Args:
            name: Entity/attribute name
            attribute_type: Attribute type (None for base entity)

        Returns:
            True if successful, False otherwise
        """
        if not cls.validate_entity_name(name):
            logger.warning("[FILTER_RULE_SERVICE] Invalid entity name: %s", name)
            return False

        try:
            # Load current rules
            rules_data = cls.get_all_rules()

            # Check for duplicates
            if cls._entity_exists(rules_data, name):
                logger.warning("[FILTER_RULE_SERVICE] Entity already exists: %s", name)
                return False

            # Add new entity
            new_entity = FilterEntity(name=name, attribute_type=attribute_type)
            if new_entity.is_base_entity():
                rules_data.entities.append(new_entity)
            else:
                rules_data.attributes.append(new_entity)

            # Update CSV
            return cls.update_rules(rules_data)

        except Exception:
            logger.exception("[FILTER_RULE_SERVICE] Failed to add entity: %s", name)
            return False

    @classmethod
    def update_entity(cls, old_name: str, new_name: str, attribute_type: Optional[str] = None) -> bool:
        """
        Update an existing entity or attribute.

        Args:
            old_name: Current entity/attribute name
            new_name: New entity/attribute name
            attribute_type: New attribute type (None for base entity)

        Returns:
            True if successful, False otherwise
        """
        if not cls.validate_entity_name(new_name):
            logger.warning("[FILTER_RULE_SERVICE] Invalid entity name: %s", new_name)
            return False

        try:
            # Load current rules
            rules_data = cls.get_all_rules()

            # Find and update entity
            updated = False

            for i, entity in enumerate(rules_data.entities):
                if entity.name == old_name:
                    rules_data.entities[i] = FilterEntity(name=new_name, attribute_type=attribute_type)
                    updated = True
                    break

            if not updated:
                for i, attr in enumerate(rules_data.attributes):
                    if attr.name == old_name:
                        rules_data.attributes[i] = FilterEntity(name=new_name, attribute_type=attribute_type)
                        updated = True
                        break

            if not updated:
                logger.warning("[FILTER_RULE_SERVICE] Entity not found: %s", old_name)
                return False

            # Update CSV
            return cls.update_rules(rules_data)

        except Exception:
            logger.exception("[FILTER_RULE_SERVICE] Failed to update entity: %s", old_name)
            return False

    @classmethod
    def delete_entity(cls, name: str) -> bool:
        """
        Delete an entity or attribute.

        Args:
            name: Entity/attribute name to delete

        Returns:
            True if successful, False otherwise
        """
        try:
            # Load current rules
            rules_data = cls.get_all_rules()

            # Remove entity
            original_entity_count = len(rules_data.entities)
            original_attr_count = len(rules_data.attributes)

            rules_data.entities = [e for e in rules_data.entities if e.name != name]
            rules_data.attributes = [a for a in rules_data.attributes if a.name != name]

            # Check if anything was deleted
            if (
                len(rules_data.entities) == original_entity_count
                and len(rules_data.attributes) == original_attr_count
            ):
                logger.warning("[FILTER_RULE_SERVICE] Entity not found: %s", name)
                return False

            # Update CSV
            return cls.update_rules(rules_data)

        except Exception:
            logger.exception("[FILTER_RULE_SERVICE] Failed to delete entity: %s", name)
            return False

    @classmethod
    def validate_entity_name(cls, name: str) -> bool:
        """
        Validate entity/attribute name.

        Args:
            name: Entity/attribute name

        Returns:
            True if valid, False otherwise
        """
        if not name or not name.strip():
            return False

        # Check length
        if len(name.strip()) > 100:
            return False

        return True

    @classmethod
    def _entity_exists(cls, rules_data: FilterRulesData, name: str) -> bool:
        """Check if an entity/attribute with the given name already exists"""
        all_names = [e.name for e in rules_data.entities] + [a.name for a in rules_data.attributes]
        return name in all_names

    @classmethod
    def _backup_csv(cls) -> None:
        """Create a backup of the current CSV file"""
        csv_path = cls.get_csv_path()

        if not csv_path.exists():
            return

        try:
            backup_dir = csv_path.parent / "backups"
            backup_dir.mkdir(exist_ok=True)

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_path = backup_dir / f"filter_rules_backup_{timestamp}.csv"

            shutil.copy2(csv_path, backup_path)
            logger.info("[FILTER_RULE_SERVICE] Created backup: %s", backup_path)

            # Keep only the last 10 backups
            cls._cleanup_old_backups(backup_dir, keep=10)

        except Exception:
            logger.exception("[FILTER_RULE_SERVICE] Failed to create backup")

    @classmethod
    def _cleanup_old_backups(cls, backup_dir: Path, keep: int = 10) -> None:
        """Remove old backup files, keeping only the most recent ones"""
        try:
            backup_files = sorted(backup_dir.glob("filter_rules_backup_*.csv"), key=os.path.getmtime, reverse=True)

            for backup_file in backup_files[keep:]:
                backup_file.unlink()

        except Exception:
            logger.exception("[FILTER_RULE_SERVICE] Failed to cleanup old backups")

    @classmethod
    def _clear_cache(cls) -> None:
        """Clear the FilterRuleLoader cache to reload rules"""
        try:
            from core.rag.filter.filter_rule_loader import FilterRuleLoader

            FilterRuleLoader.clear_cache()
            logger.info("[FILTER_RULE_SERVICE] Cleared FilterRuleLoader cache")
        except Exception:
            logger.exception("[FILTER_RULE_SERVICE] Failed to clear cache")

