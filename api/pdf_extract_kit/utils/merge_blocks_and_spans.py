# revised from https://github.com/opendatalab/MinerU/blob/7f0fe20004af7416db886f4b75c116bcc1c986b4/magic_pdf/pdf_parse_union_core.py#L177
# from fast_langdetect import detect_language
# import unicodedata
import re


def __is_overlaps_y_exceeds_threshold(bbox1, bbox2, overlap_ratio_threshold=0.8):
    """检查两个bbox在y轴上是否有重叠，并且该重叠区域的高度占两个bbox高度更低的那个超过80%"""
    _, y0_1, _, y1_1 = bbox1
    _, y0_2, _, y1_2 = bbox2

    overlap = max(0, min(y1_1, y1_2) - max(y0_1, y0_2))
    height1, height2 = y1_1 - y0_1, y1_2 - y0_2
    max_height = max(height1, height2)
    min_height = min(height1, height2)

    return (overlap / min_height) > overlap_ratio_threshold

def merge_spans_to_line(spans):
    if len(spans) == 0:
        return []
    else:
        # 按照y0坐标排序
        spans.sort(key=lambda span: span['bbox'][1])

        lines = []
        current_line = [spans[0]]
        for span in spans[1:]:
            # 如果当前的span类型为"isolated" 或者 当前行中已经有"isolated"
            # image和table类型，同上
            if span['type'] in ['isolated'] or any(
                    s['type'] in ['isolated'] for s in
                    current_line):
                # 则开始新行
                lines.append(current_line)
                current_line = [span]
                continue

            # 如果当前的span与当前行的最后一个span在y轴上重叠，则添加到当前行
            if __is_overlaps_y_exceeds_threshold(span['bbox'], current_line[-1]['bbox']):
                current_line.append(span)
            else:
                # 否则，开始新行
                lines.append(current_line)
                current_line = [span]

        # 添加最后一行
        if current_line:
            lines.append(current_line)

        return lines

# 将每一个line中的span从左到右排序
def line_sort_spans_by_left_to_right(lines):
    line_objects = []
    for line in lines:
        # 按照x0坐标排序
        line.sort(key=lambda span: span['bbox'][0])
        line_bbox = [
            min(span['bbox'][0] for span in line),  # x0
            min(span['bbox'][1] for span in line),  # y0
            max(span['bbox'][2] for span in line),  # x1
            max(span['bbox'][3] for span in line),  # y1
        ]
        line_objects.append({
            "bbox": line_bbox,
            "spans": line,
        })
    return line_objects

def fix_text_block(block):
    # 文本block中的公式span都应该转换成行内type
    for span in block['spans']:
        if span['type'] == "isolated":
            span['type'] = "inline"
    block_lines = merge_spans_to_line(block['spans'])
    sort_block_lines = line_sort_spans_by_left_to_right(block_lines)
    block['lines'] = sort_block_lines
    del block['spans']
    return block


def fix_interline_block(block):
    block_lines = merge_spans_to_line(block['spans'])
    sort_block_lines = line_sort_spans_by_left_to_right(block_lines)
    block['lines'] = sort_block_lines
    del block['spans']
    return block

def calculate_overlap_area_in_bbox1_area_ratio(bbox1, bbox2):
    """
    计算box1和box2的重叠面积占bbox1的比例
    """
    # Determine the coordinates of the intersection rectangle
    x_left = max(bbox1[0], bbox2[0])
    y_top = max(bbox1[1], bbox2[1])
    x_right = min(bbox1[2], bbox2[2])
    y_bottom = min(bbox1[3], bbox2[3])

    if x_right < x_left or y_bottom < y_top:
        return 0.0

    # The area of overlap area
    intersection_area = (x_right - x_left) * (y_bottom - y_top)
    bbox1_area = (bbox1[2]-bbox1[0])*(bbox1[3]-bbox1[1])
    if bbox1_area == 0:
        return 0
    else:
        return intersection_area / bbox1_area

def fill_spans_in_blocks(blocks, spans, radio):
    '''
    将allspans中的span按位置关系，放入blocks中
    '''
    block_with_spans = []
    for block in blocks:
        block_type = block["category_type"]
        L = block['poly'][0]
        U = block['poly'][1]
        R = block['poly'][2]
        D = block['poly'][5]
        L, R = min(L, R), max(L, R)
        U, D = min(U, D), max(U, D)
        block_bbox = [L, U, R, D]
        block_dict = {
            'type': block_type,
            'bbox': block_bbox,
            'saved_info': block
        }
        block_spans = []
        for span in spans:
            span_bbox = span["bbox"]
            if calculate_overlap_area_in_bbox1_area_ratio(span_bbox, block_bbox) > radio:
                block_spans.append(span)

        '''行内公式调整, 高度调整至与同行文字高度一致(优先左侧, 其次右侧)'''
        # displayed_list = []
        # text_inline_lines = []
        # modify_y_axis(block_spans, displayed_list, text_inline_lines)

        '''模型识别错误的行间公式, type类型转换成行内公式'''
        # block_spans = modify_inline(block_spans, displayed_list, text_inline_lines)

        '''bbox去除粘连'''  # 去粘连会影响span的bbox，导致后续fill的时候出错
        # block_spans = remove_overlap_between_bbox_for_span(block_spans)

        block_dict['spans'] = block_spans
        block_with_spans.append(block_dict)

        # 从spans删除已经放入block_spans中的span
        if len(block_spans) > 0:
            for span in block_spans:
                spans.remove(span)

    return block_with_spans, spans

def fix_block_spans(block_with_spans):
    '''
    1、img_block和table_block因为包含caption和footnote的关系，存在block的嵌套关系
        需要将caption和footnote的text_span放入相应img_block和table_block内的
        caption_block和footnote_block中
    2、同时需要删除block中的spans字段
    '''
    fix_blocks = []
    for block in block_with_spans:
        block_type = block['type']

        # if block_type == BlockType.Image:
        #     block = fix_image_block(block, img_blocks)
        # elif block_type == BlockType.Table:
        #     block = fix_table_block(block, table_blocks)
        if block_type == "isolate_formula":
            block = fix_interline_block(block)
        else:
            block = fix_text_block(block)
        fix_blocks.append(block)
    return fix_blocks


# def detect_lang(text: str) -> str:

#     if len(text) == 0:
#         return ""
#     try:
#         lang_upper = detect_language(text)
#     except:
#         html_no_ctrl_chars = ''.join([l for l in text if unicodedata.category(l)[0] not in ['C', ]])
#         lang_upper = detect_language(html_no_ctrl_chars)
#     try:
#         lang = lang_upper.lower()
#     except:
#         lang = ""
#     return lang

def detect_lang(string):
    """
    检查整个字符串是否包含中文
    :param string: 需要检查的字符串
    :return: bool
    """

    for ch in string:
        if u'\u4e00' <= ch <= u'\u9fff':
            return 'zh'
    return 'en'

def ocr_escape_special_markdown_char(content):
    """
    转义正文里对markdown语法有特殊意义的字符
    """
    special_chars = ["*", "`", "~", "$"]
    for char in special_chars:
        content = content.replace(char, "\\" + char)

    return content

# def split_long_words(text):
#     segments = text.split(' ')
#     for i in range(len(segments)):
#         words = re.findall(r'\w+|[^\w]', segments[i], re.UNICODE)
#         for j in range(len(words)):
#             if len(words[j]) > 15:
#                 words[j] = ' '.join(wordninja.split(words[j]))
#         segments[i] = ''.join(words)
#     return ' '.join(segments)


def merge_para_with_text(para_block):
    para_text = ''
    for line in para_block['lines']:
        line_text = ""
        line_lang = ""
        for span in line['spans']:
            span_type = span['type']
            if span_type == "text":
                line_text += span['content'].strip()
        if line_text != "":
            line_lang = detect_lang(line_text)
        for span in line['spans']:
            span_type = span['type']
            content = ''
            if span_type == "text":
                content = span['content']
                content = ocr_escape_special_markdown_char(content)
                # language = detect_lang(content)
                # if language == 'en':  # 只对英文长词进行分词处理，中文分词会丢失文本
                    # content = ocr_escape_special_markdown_char(split_long_words(content))
                # else:
                #     content = ocr_escape_special_markdown_char(content)
            elif span_type == 'inline':
                content = f" ${span['content'].strip('$')}$ "
            elif span_type == 'ignore-formula':
                content = f" ${span['content'].strip('$')}$ "
            elif span_type == 'isolated':
                content = f"\n$$\n{span['content'].strip('$')}\n$$\n"    
            elif span_type == 'footnote':
                content_ori = span['content'].strip('$')
                if '^' in content_ori:
                    content = f" ${content_ori}$ "
                else:
                    content = f" $^{content_ori}$ "

            if content != '':
                if 'zh' in line_lang:  # 遇到一些一个字一个span的文档，这种单字语言判断不准，需要用整行文本判断
                    para_text += content.strip()  # 中文语境下，content间不需要空格分隔
                else:
                    para_text += content.strip() + ' '  # 英文语境下 content间需要空格分隔
    return para_text