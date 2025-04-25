from typing import TYPE_CHECKING, Any, cast

from core.datasource import datasource_file_manager
from core.datasource.datasource_file_manager import DatasourceFileManager

if TYPE_CHECKING:
    from core.datasource.datasource_file_manager import DatasourceFileManager

tool_file_manager: dict[str, Any] = {"manager": None}


class DatasourceFileParser:
    @staticmethod
    def get_datasource_file_manager() -> "DatasourceFileManager":
        return cast("DatasourceFileManager", datasource_file_manager["manager"])
