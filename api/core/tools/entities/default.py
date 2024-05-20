from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolLabel

default_tool_labels = [
    ToolLabel(name='search', label=I18nObject(en_US='Search', zh_Hans='搜索')),
    ToolLabel(name='image', label=I18nObject(en_US='Image', zh_Hans='图片')),
    ToolLabel(name='videos', label=I18nObject(en_US='Videos', zh_Hans='视频')),
    ToolLabel(name='weather', label=I18nObject(en_US='Weather', zh_Hans='天气')),
    ToolLabel(name='finance', label=I18nObject(en_US='Finance', zh_Hans='金融')),
    ToolLabel(name='calender', label=I18nObject(en_US='Calender', zh_Hans='日历')),
    ToolLabel(name='knowledge', label=I18nObject(en_US='Knowledge', zh_Hans='知识'))
]

default_tool_label_list = [label.name for label in default_tool_labels]