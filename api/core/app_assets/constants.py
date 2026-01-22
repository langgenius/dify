from core.app.entities.app_asset_entities import AppAssetFileTree
from libs.attr_map import AttrKey


class AppAssetsAttrs:
    # Skill artifact set
    FILE_TREE = AttrKey("file_tree", AppAssetFileTree)
