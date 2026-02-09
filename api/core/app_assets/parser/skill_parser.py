import json
import logging
from typing import Any

from core.app_assets.entities import SkillAsset
from core.app_assets.entities.assets import AssetItem, FileAsset
from extensions.ext_storage import storage

from .base import AssetItemParser

logger = logging.getLogger(__name__)


class SkillAssetParser(AssetItemParser):
    """
    Parser for skill assets.

    Responsibilities:
    - Read file from storage
    - Parse JSON structure
    - Return SkillAsset with raw metadata (no parsing/resolution)

    Metadata parsing and content resolution are handled by SkillCompiler.
    """

    def parse(
        self,
        asset_id: str,
        path: str,
        file_name: str,
        extension: str,
        storage_key: str,
    ) -> AssetItem:
        try:
            data = json.loads(storage.load_once(storage_key))
            if not isinstance(data, dict):
                raise ValueError(f"Skill document {asset_id} must be a JSON object")

            metadata_raw: dict[str, Any] = data.get("metadata", {})

            return SkillAsset(
                asset_id=asset_id,
                path=path,
                file_name=file_name,
                extension=extension,
                storage_key=storage_key,
                metadata=metadata_raw,
            )
        except Exception:
            logger.exception("Failed to parse skill asset %s", asset_id)
            return FileAsset(
                asset_id=asset_id,
                path=path,
                file_name=file_name,
                extension=extension,
                storage_key=storage_key,
            )
