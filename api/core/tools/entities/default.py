from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolLabel

default_tool_types = [
    ToolLabel(name='search', label=I18nObject(en='Search', zh='搜索')),
    ToolLabel(name='image', label=I18nObject(en='Image', zh='图片')),
    ToolLabel(name='videos', label=I18nObject(en='Videos', zh='视频')),
    ToolLabel(name='weather', label=I18nObject(en='Weather', zh='天气')),
    ToolLabel(name='finance', label=I18nObject(en='Finance', zh='金融')),
    ToolLabel(name='calender', label=I18nObject(en='Calender', zh='日历')),
    ToolLabel(name='knowledge', label=I18nObject(en='Knowledge', zh='知识'))
]