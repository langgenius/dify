from pathlib import Path

from matplotlib.font_manager import FontProperties

current_dir = Path(__file__).parent
font_path = current_dir / "_assets" / "SourceHanSansSC-Regular.otf"
font_properties = FontProperties(fname=font_path)
