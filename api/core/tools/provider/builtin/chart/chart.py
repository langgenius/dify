import matplotlib.pyplot as plt
from fontTools.ttLib import TTFont
from matplotlib.font_manager import findSystemFonts

from core.tools.entities.values import ToolLabelEnum
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.chart.tools.line import LinearChartTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController

# use a business theme
plt.style.use('seaborn-v0_8-darkgrid')
plt.rcParams['axes.unicode_minus'] = False

def init_fonts():
    fonts = findSystemFonts()

    popular_unicode_fonts = [
        'Arial Unicode MS', 'DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif', 'FreeMono', 'FreeSans', 'FreeSerif',
        'Liberation Mono', 'Liberation Sans', 'Liberation Serif', 'Noto Mono', 'Noto Sans', 'Noto Serif', 'Open Sans',
        'Roboto', 'Source Code Pro', 'Source Sans Pro', 'Source Serif Pro', 'Ubuntu', 'Ubuntu Mono'
    ]

    supported_fonts = []

    for font_path in fonts:
        try:
            font = TTFont(font_path)
            # get family name
            family_name = font['name'].getName(1, 3, 1).toUnicode()
            if family_name in popular_unicode_fonts:
                supported_fonts.append(family_name)
        except:
            pass

    plt.rcParams['font.family'] = 'sans-serif'
    # sort by order of popular_unicode_fonts
    for font in popular_unicode_fonts:
        if font in supported_fonts:
            plt.rcParams['font.sans-serif'] = font
            break
    
init_fonts()

class ChartProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            LinearChartTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id='',
                tool_parameters={
                    "data": "1,3,5,7,9,2,4,6,8,10",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
        
    def _get_tool_labels(self) -> list[ToolLabelEnum]:
        return [
            ToolLabelEnum.DESIGN, ToolLabelEnum.PRODUCTIVITY, ToolLabelEnum.UTILITIES
        ]