from services.tools.tool_labels_service import ToolLabelsService


def test_list_tool_labels_returns_default_labels():
    result = ToolLabelsService.list_tool_labels()
    assert isinstance(result, list)
    assert len(result) > 0


def test_list_tool_labels_items_are_tool_labels():
    from core.tools.entities.tool_entities import ToolLabel

    result = ToolLabelsService.list_tool_labels()
    for label in result:
        assert isinstance(label, ToolLabel)


def test_list_tool_labels_matches_default_values():
    from core.tools.entities.values import default_tool_labels

    assert ToolLabelsService.list_tool_labels() is default_tool_labels
