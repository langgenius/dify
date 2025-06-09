class ReadPdfService:

    @classmethod
    def load_content(cls, pdf_file_path: str) -> str | None:
        doc = None
        try:
            # PDF标题提取（需要pymupdf库）
            import fitz
            doc = fitz.open(pdf_file_path)
            contents = []
            for page in doc:
                page_height = page.rect.height
                page_width = page.rect.width
                # 旧版本中 Page 对象可能没有 get_text 方法，使用 getText 方法替代
                # 从 v1.21.0 版本开始，fitz.Page 类的 getText 方法已被弃用，应使用 get_text 方法
                blocks = page.get_text("dict")["blocks"]  # type: ignore
                page_number = page.number
                # if page_number == 39:
                #     print("-----------------------------")
                blocks = cls.handle_blocks(blocks)
                for block in blocks:
                    # if page_number == 39:
                    #     print("-----------------------------")
                    #     print(block)
                    type = block["type"]
                    if type == 1:
                        continue
                    content = cls.get_block_content(block,page_width,page_height)
                    if content is not None:
                        # if "图5-5" in content:
                        #     # print(content)
                        #     print("aaaaaaaaa")
                        contents.append(content)
            return "\n".join(contents)
        finally:
            if doc is not None:
                doc.close()

    @classmethod
    def handle_blocks(cls, blocks: list[dict]) -> list[dict] | None:
        if blocks is not None:
            handle_block_list = cls.sort_blocks(blocks)
            handle_block_list = cls.filter_inner_img_block(handle_block_list)
            return handle_block_list
        return blocks

    @classmethod
    def sort_blocks(cls, blocks: list[dict]) -> list[dict] | None:
        if blocks is not None:
            def custom_sorted(block:dict) -> float:
                bbox = block["bbox"]
                return bbox[1]
            sorted_data_asc = sorted(blocks, key=custom_sorted)
            return sorted_data_asc
        return blocks

    @classmethod
    def handle_lines(cls, blocks: list[dict]) -> list[dict] | None:
        if blocks is not None:

            def top_sorted(block:dict) -> float:
                bbox = block["bbox"]
                return bbox[1]

            def left_sorted(block:dict) -> float:
                bbox = block["bbox"]
                return bbox[0]
            sorted_data_asc = sorted(blocks, key=top_sorted)
            sorted_data_asc = sorted(sorted_data_asc, key=left_sorted)

            return sorted_data_asc
        return blocks

    @classmethod
    def is_inner_img_block(cls, block: dict, img_bboxs: list[dict]) -> bool:
        is_inner_img = False
        type = block["type"]
        if type != 1:
            for img_bbox in img_bboxs:
                if not is_inner_img:
                    bbox = block["bbox"]
                    is_inner_ = (bbox[0] >= img_bbox[0]
                                 and bbox[1] >= img_bbox[1]
                                 and bbox[2] <= img_bbox[2]
                                 and bbox[3] <= img_bbox[3])
                    if is_inner_:
                        is_inner_img = True
        return is_inner_img

    @classmethod
    def get_only_row_img_bboxs(cls, blocks: list[dict],img_bboxs: list[dict]) -> list[dict]:
        # 判断图片是否是单独一行，单独一行的图片，内部的文字正常处理，反之，不处理（如果两个图片并列的话，内部的文字也是正常处理）
        only_row_img_bboxs = []
        for img_bbox in img_bboxs:
            # 同层级是否只有图片
            is_only_img = True
            for block in blocks:
                type = block["type"]
                if type != 1:
                    bbox = block["bbox"]
                    # 判断当前是否是不在图片内的文本
                    is_inner_img = cls.is_inner_img_block(block, img_bboxs)
                    # 判断当前是否在同层级
                    is_save_level = (
                        (
                            bbox[0] > img_bbox[2]
                            or bbox[2] < img_bbox[0]
                        )
                        and bbox[1] >= img_bbox[1]
                        and bbox[3] <= img_bbox[3]
                    )
                    if not is_inner_img and is_save_level:
                        is_only_img = False
            if is_only_img:
                only_row_img_bboxs.append(img_bbox)
        return only_row_img_bboxs

    @classmethod
    def filter_inner_img_block(cls, blocks: list[dict]) -> list[dict] | None:
        if blocks is not None:
            # 判断是否有图片
            img_bboxs:list[dict] = []
            for block in blocks:
                bbox = block["bbox"]
                type = block["type"]
                if type == 1:
                    img_bboxs.append(bbox)
            if len(img_bboxs) > 0:
                # 获取所有单独在一行的图片区域集合
                only_row_img_bboxs = cls.get_only_row_img_bboxs(blocks, img_bboxs)
                filter_blocks: list[dict] = []
                for block in blocks:
                    type = block["type"]
                    if type != 1:
                        # 判断是否在单行都是图片的区域
                        is_only_row_img = cls.is_inner_img_block(block, only_row_img_bboxs)
                        # 判断是否在图片区域内
                        is_inner_img = cls.is_inner_img_block(block, img_bboxs)
                        # 如果在单行都是图片的区域内，返回值。或者不在图片区域内，返回值。
                        if is_only_row_img or not is_inner_img:
                            filter_blocks.append(block)
                        # else:
                        #     content_ = cls.load_block_content(block)
                        #     print(content_)
                return filter_blocks
        return blocks

    @classmethod
    def get_block_content(cls, block: dict, page_width: float, page_height : float) -> str | None:

        header = cls.is_header_fitz(block=block, page_width=page_width, page_height=page_height)
        footer = cls.is_footer_fitz(block=block, page_width=page_width, page_height=page_height)

        if not header and not footer:
            return cls.load_block_content(block=block)
        return None

    @classmethod
    def load_block_content(cls, block: dict) -> str | None:
        if "lines" in block:
            line_texts = []
            lines = cls.handle_lines(block["lines"])
            for line in lines:
                texts = []
                for span in line["spans"]:
                    text = span["text"].strip()
                    if text:
                        texts.append(text)
                if len(texts) > 0:
                    line_text = "".join(texts)
                    line_texts.append(line_text)
            if len(line_texts) > 0:
                # print("************************************",len(line_texts))
                # print("\n".join(line_texts))
                return "\n".join(line_texts)
        return None

    @classmethod
    def is_heading_fitz(cls, span: dict, page_width: float) -> bool:
        """
        判断一个文本片段是否为标题
        :param span: PyMuPDF 返回的文本片段信息
        :param page_width: 页面宽度（用于判断位置）
        :return: 是否为标题
        """
        # 特征 1：字体加粗
        is_bold = "bold" in span["font"].lower()

        # 特征 2：字体大小（相对较大）
        is_large_font = span["size"] > 14  # 适当降低阈值

        # 特征 3：文本位置（靠近页面顶部或居中）
        is_top = span["origin"][1] < 100  # 距离页面顶部小于 100 像素
        is_centered = abs(span["origin"][0] - page_width / 2) < 50  # 水平居中

        # 特征 4：文本格式（包含大写字母或编号）
        text = span["text"].strip()
        is_uppercase = text.isupper()
        is_numbered = any(text.startswith(f"{i}.") for i in range(1, 10))  # 如 "1.", "2."

        # 综合判断
        # return is_bold or is_large_font
        # flg = (is_bold or is_large_font) and (is_top or is_centered) and (is_uppercase or is_numbered)
        flg = is_numbered
        if flg :
            print("标题：",text)
        return flg

    @classmethod
    def is_top_fitz(cls, bbox_top: float) -> bool:
        # print("----------------",bbox_top)
        if bbox_top < 58:
            return True
        return False

    @classmethod
    def is_bottom_fitz(cls, bbox_bottom: float, page_height) -> bool:
        # print("----------------",bbox_top)
        if bbox_bottom > page_height - 60:
            return True
        return False

    @classmethod
    def is_centered_fitz(cls, origin_x: float, page_width: float) -> bool:
        is_centered = abs(origin_x - page_width / 2) < 20  # 水平居中
        return is_centered

    @classmethod
    def get_origin_bybbox(cls,bbox:list[float]) -> list[float]:
        x = (bbox[0] + bbox[2]) / 2
        y = (bbox[1] + bbox[3]) / 2
        origin = list([x,y])
        return origin

    @classmethod
    def get_first_span(cls,block:dict) -> dict | None:
        if "lines" in block and len(block["lines"]) > 0:
            lines = block["lines"]
            line = lines[0]
            return line["spans"][0]
        return None

    @classmethod
    def is_bold_byspan(cls,span:dict) -> bool:
        is_bold = "bold" in span["font"].lower()
        return is_bold

    @classmethod
    def is_header_fitz(cls,block: dict,page_width: float, page_height: float) -> bool:
        # 判断block
        if block:
            bbox = block["bbox"]
            # number = block["number"]
            origin = cls.get_origin_bybbox(bbox)
            if "lines" in block and len(block["lines"]) == 1:
                span = cls.get_first_span(block)
                # 是否加粗
                is_bold = cls.is_bold_byspan(span)
                # 判断字体是否比较小
                is_font_size = span["size"] < 10
                # 不满行
                is_not_full_line = bbox[0] > 120 or (bbox[3] < (page_width  -120))
                # 靠近页面顶部
                is_top = cls.is_top_fitz(bbox_top = bbox[1])  # 距离页面顶部小于 100 像素
                # 水平居中
                is_centered = cls.is_centered_fitz(origin_x = origin[0], page_width=page_width)
                # 在判断字体是否加粗，或者字体大小，一般页眉页脚的字体比较小
                return is_top or ( bbox[1] < 70 and not is_bold and is_font_size and is_centered and is_not_full_line  )
        return False

    @classmethod
    def is_footer_fitz(cls,block: dict,page_width: float, page_height: float) -> bool:
        # 判断block
        if block:
            bbox = block["bbox"]
            # number = block["number"]
            origin = cls.get_origin_bybbox(bbox)
            if "lines" in block :
                span = cls.get_first_span(block)
                # 是否加粗
                is_bold = cls.is_bold_byspan(span)
                # 判断字体是否比较小
                is_font_size = span["size"] < 10
                # 不满行
                is_not_full_line = bbox[0] > 120 or (bbox[3] < (page_width  -120))
                # 靠近页面顶部
                is_bottom = cls.is_bottom_fitz(bbox_bottom = bbox[3],page_height=page_height)  # 距离页面顶部小于 100 像素
                # 水平居中
                is_centered = cls.is_centered_fitz(origin_x = origin[0], page_width=page_width)
                # 在判断字体是否加粗，或者字体大小，一般页眉页脚的字体比较小
                return is_bottom or ( bbox[3] > page_height - 70 and not is_bold and is_font_size and is_centered and is_not_full_line  )
        return False

if __name__ == "__main__":
    readPdfService = ReadPdfService()
    content = readPdfService.load_content(pdf_file_path=r"D:\a.pdf")
    # print(content)
    print(content)
    # PyPdfService.get_headline_page_dictionary(pdf_file_path=r"D:\a.pdf")