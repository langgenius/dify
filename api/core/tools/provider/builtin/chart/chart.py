import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties, fontManager

from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


def set_chinese_font():
    font_list = [
        "PingFang SC",
        "SimHei",
        "Microsoft YaHei",
        "STSong",
        "SimSun",
        "Arial Unicode MS",
        "Noto Sans CJK SC",
        "Noto Sans CJK JP",
    ]

    for font in font_list:
        if font in fontManager.ttflist:
            chinese_font = FontProperties(font)
            if chinese_font.get_name() == font:
                return chinese_font

    return FontProperties()


# use a business theme
plt.style.use("seaborn-v0_8-darkgrid")
plt.rcParams["axes.unicode_minus"] = False
font_properties = set_chinese_font()
plt.rcParams["font.family"] = font_properties.get_name()


class ChartProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        pass
