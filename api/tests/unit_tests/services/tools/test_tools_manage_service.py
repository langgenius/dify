from unittest.mock import MagicMock, patch

from services.tools.tools_manage_service import ToolCommonService


class TestToolCommonService:
    @patch("services.tools.tools_manage_service.ToolTransformService")
    @patch("services.tools.tools_manage_service.ToolManager")
    def test_list_tool_providers_transforms_and_returns(self, mock_manager, mock_transform):
        mock_provider1 = MagicMock()
        mock_provider1.to_dict.return_value = {"name": "provider1"}
        mock_provider2 = MagicMock()
        mock_provider2.to_dict.return_value = {"name": "provider2"}
        mock_manager.list_providers_from_api.return_value = [mock_provider1, mock_provider2]

        result = ToolCommonService.list_tool_providers("user-1", "tenant-1")

        mock_manager.list_providers_from_api.assert_called_once_with("user-1", "tenant-1", None)
        assert mock_transform.repack_provider.call_count == 2
        assert result == [{"name": "provider1"}, {"name": "provider2"}]

    @patch("services.tools.tools_manage_service.ToolTransformService")
    @patch("services.tools.tools_manage_service.ToolManager")
    def test_list_tool_providers_with_type_filter(self, mock_manager, mock_transform):
        mock_manager.list_providers_from_api.return_value = []

        result = ToolCommonService.list_tool_providers("user-1", "tenant-1", typ="builtin")

        mock_manager.list_providers_from_api.assert_called_once_with("user-1", "tenant-1", "builtin")
        assert result == []

    @patch("services.tools.tools_manage_service.ToolTransformService")
    @patch("services.tools.tools_manage_service.ToolManager")
    def test_list_tool_providers_empty(self, mock_manager, mock_transform):
        mock_manager.list_providers_from_api.return_value = []

        result = ToolCommonService.list_tool_providers("u", "t")

        assert result == []
        mock_transform.repack_provider.assert_not_called()
