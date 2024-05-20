from enum import Enum

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolLabel


class ToolLabelEnum(Enum):
    SEARCH = 'search'
    IMAGE = 'image'
    VIDEOS = 'videos'
    WEATHER = 'weather'
    FINANCE = 'finance'
    DESIGN = 'design'
    TRAVEL = 'travel'
    SOCIAL = 'social'
    NEWS = 'news'
    MEDICAL = 'medical'
    PRODUCTIVITY = 'productivity'
    EDUCATION = 'education'
    BUSINESS = 'business'
    ENTERTAINMENT = 'entertainment'
    UTILITIES = 'utilities'
    OTHER = 'other'

default_tool_label_dict = {
    ToolLabelEnum.SEARCH: ToolLabel(name='search', label=I18nObject(en_US='Search', zh_Hans='搜索')),
    ToolLabelEnum.IMAGE: ToolLabel(name='image', label=I18nObject(en_US='Image', zh_Hans='图片')),
    ToolLabelEnum.VIDEOS: ToolLabel(name='videos', label=I18nObject(en_US='Videos', zh_Hans='视频')),
    ToolLabelEnum.WEATHER: ToolLabel(name='weather', label=I18nObject(en_US='Weather', zh_Hans='天气')),
    ToolLabelEnum.FINANCE: ToolLabel(name='finance', label=I18nObject(en_US='Finance', zh_Hans='金融')),
    ToolLabelEnum.DESIGN: ToolLabel(name='design', label=I18nObject(en_US='Design', zh_Hans='设计')),
    ToolLabelEnum.TRAVEL: ToolLabel(name='travel', label=I18nObject(en_US='Travel', zh_Hans='旅行')),
    ToolLabelEnum.SOCIAL: ToolLabel(name='social', label=I18nObject(en_US='Social', zh_Hans='社交')),
    ToolLabelEnum.NEWS: ToolLabel(name='news', label=I18nObject(en_US='News', zh_Hans='新闻')),
    ToolLabelEnum.MEDICAL: ToolLabel(name='medical', label=I18nObject(en_US='Medical', zh_Hans='医疗')),
    ToolLabelEnum.PRODUCTIVITY: ToolLabel(name='productivity', label=I18nObject(en_US='Productivity', zh_Hans='生产力')),
    ToolLabelEnum.EDUCATION: ToolLabel(name='education', label=I18nObject(en_US='Education', zh_Hans='教育')),
    ToolLabelEnum.BUSINESS: ToolLabel(name='business', label=I18nObject(en_US='Business', zh_Hans='商业')),
    ToolLabelEnum.ENTERTAINMENT: ToolLabel(name='entertainment', label=I18nObject(en_US='Entertainment', zh_Hans='娱乐')),
    ToolLabelEnum.UTILITIES: ToolLabel(name='utilities', label=I18nObject(en_US='Utilities', zh_Hans='工具')),
    ToolLabelEnum.OTHER: ToolLabel(name='other', label=I18nObject(en_US='Other', zh_Hans='其他')),
}

default_tool_labels = [v for k, v in default_tool_label_dict.items()]
default_tool_label_list = [label.name for label in default_tool_labels]
