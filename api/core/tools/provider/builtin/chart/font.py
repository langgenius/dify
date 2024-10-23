from matplotlib.font_manager import FontProperties


def set_chinese_font():
    font_list = ['PingFang SC', 'SimHei', 'Microsoft YaHei', 'STSong', 'SimSun', 'Arial Unicode MS', 
                 'Noto Sans CJK SC', 'Noto Sans CJK JP']
    
    for font in font_list:
        chinese_font = FontProperties(font)
        if chinese_font.get_name() == font: 
            return chinese_font

    return FontProperties()


font_properties = set_chinese_font()
