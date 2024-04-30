"""Abstract interface for document loader implementations."""
import base64
from typing import Optional

import fitz
import numpy as np
from paddleocr import PaddleOCR

from core.rag.extractor.extractor_base import BaseExtractor
from core.rag.models.document import Document
from extensions.ext_storage import storage


class OCRPdfExtractor(BaseExtractor):
    """Load pdf files.


    Args:
        file_path: Path to the file to load.
    """

    def __init__(
            self,
            file_path: str,
            file_cache_key: Optional[str] = None
    ):
        """Initialize with file path."""
        self._file_path = file_path
        self._file_cache_key = file_cache_key

    def extract(self) -> list[Document]:
        plaintext_file_key = ''
        plaintext_file_exists = False
        if self._file_cache_key:
            try:
                text = storage.load(self._file_cache_key).decode('utf-8')
                plaintext_file_exists = True
                return [Document(page_content=text)]
            except FileNotFoundError:
                pass
        text_list = []
        documents = []
        
        doc = fitz.open(self._file_path)
        for i in range(doc.page_count):
            page = doc.load_page(i)
            pix = page.get_pixmap() # 将 PDF 页面转换成一个图像
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape((pix.h, pix.w, pix.n))

            img_data = {
                "img64": base64.b64encode(img).decode("utf-8"), 
                "height": pix.h, 
                "width": pix.w,
                "channels": pix.n,
            }
            result = self._ocr(img_data)
            result = [line for line in result if line]
            
            ocr_result = [i[1][0] for line in result for i in line]
            page_result = "\n".join(ocr_result)
            text_list.append(page_result)
            
            metadata = {"source": self._file_path, "page": i}
            documents.append(Document(page_content=page_result, metadata=metadata))
        
        text = '\n\n'.join(text_list)

        # save plaintext file for caching
        if not plaintext_file_exists and plaintext_file_key:
            storage.save(plaintext_file_key, text.encode('utf-8'))

        return documents
    
    
    def _ocr(self, img_data):
        ocr_engine = PaddleOCR(use_angle_cls=True, lang="ch", use_gpu=True, show_log=False)

        img_file = img_data['img64']
        height = img_data['height']
        width = img_data['width']
        channels = img_data['channels']

        binary_data = base64.b64decode(img_file)
        img_array = np.frombuffer(binary_data, dtype=np.uint8).reshape((height, width, channels))

        if not img_file:
            return 'error: No file was uploaded.'

        res = ocr_engine.ocr(img_array)

        return res
        
