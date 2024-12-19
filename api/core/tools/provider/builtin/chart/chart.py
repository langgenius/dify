import matplotlib
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties, fontManager

from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


def set_chinese_font():
    to_find_fonts = [
        "PingFang SC",
        "SimHei",
        "Microsoft YaHei",
        "STSong",
        "SimSun",
        "Arial Unicode MS",
        "Noto Sans CJK SC",
        "Noto Sans CJK JP",
    ]
    installed_fonts = frozenset(fontInfo.name for fontInfo in fontManager.ttflist)
    for font in to_find_fonts:
        if font in installed_fonts:
            return FontProperties(font)

    return FontProperties()


# use non-interactive backend to prevent `RuntimeError: main thread is not in main loop`
matplotlib.use("Agg")
# use a business theme
plt.style.use("seaborn-v0_8-darkgrid")
plt.rcParams["axes.unicode_minus"] = False
font_properties = set_chinese_font()
plt.rcParams["font.family"] = font_properties.get_name()


class ChartProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        pass
