import io
import logging
import math
import time

import fitz
from PIL import Image

from core.file import FileType
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.file.file_manager import download

from typing import Any, Dict, List, Union

logger = logging.getLogger(__name__)


class Pdf2ImgTool(BuiltinTool):
    def _invoke(self,
                user_id: str,
                tool_parameters: Dict[str, Any],
                ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        logger.info("run shopee pdf2img")
        file_variable = tool_parameters.get("file")
        width = tool_parameters.get("width", 0)
        length = tool_parameters.get("length", 0)
        dpi = tool_parameters.get("dpi", 0)

        logger.info(f'{file_variable}')
        # 不是pdf直接返回
        if file_variable.type != FileType.DOCUMENT:
            return self.create_file_message(file_variable)

        image_binary = download(file_variable)

        if not image_binary:
            return self.create_text_message("Image not found, please request user to generate image firstly.")

        res = self.handle(image_binary, width, length, dpi)
        if not res:
            return self.create_text_message("Pdf2Img error, maybe pdf is encrypted")

        return self.create_blob_message(blob=res, meta={"mime_type": "image/jpeg"})

    def handle(self, pdf_bytes, width, length, dpi=350):
        pdf_stream = io.BytesIO(pdf_bytes)
        doc = fitz.open(stream=pdf_stream, filetype="pdf")
        if 'encryption' in doc.metadata and doc.metadata['encryption'] is not None:
            if not doc.authenticate(""):
                return
        if dpi is None or dpi == 0:
            dpi = 350
        zoom = int(math.ceil(dpi / 72))
        matrix = fitz.Matrix(zoom, zoom)
        images = []
        for pageNo in range(doc.page_count):
            page = doc.load_page(pageNo)
            pix = page.get_pixmap(matrix=matrix)
            images.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))

        res = self.concat_images(images, width, length)
        doc.close()
        pdf_stream.close()
        return res

    def concat_images(self, images, target_width, target_length):
        width = 0
        height = 0
        for image in images:
            cur_width, cur_height = image.size
            width += cur_width
            height = max(cur_width, height)

        result = Image.new('RGB', (width, height))
        last_image_width = 0
        for image in images:
            result.paste(image, (last_image_width, 0))
            tmp, _ = image.size
            last_image_width += tmp
        # return result
        if target_width is not None and target_width > 0 and target_length is not None and target_length > 0:
            result = result.resize((target_width, target_length))

        image_stream = io.BytesIO()
        result.save(image_stream, format='JPEG')
        image_binary_data = image_stream.getvalue()
        image_stream.close()
        return image_binary_data


def test_func():
    doc = fitz.open("/Users/alan.li/Downloads/file (2)")
    # 创建一个字节流对象
    pdf_stream = io.BytesIO()

    # 将文档保存到字节流中
    doc.save(pdf_stream)

    # 获取二进制数据
    pdf_binary_data = pdf_stream.getvalue()

    res = Pdf2ImgTool().handle(pdf_binary_data)
    image_stream = io.BytesIO(res)

    # 打开图像
    image = Image.open(image_stream)
    # image.show()
