import io
import logging
from typing import Any, Union

from qrcode.constants import ERROR_CORRECT_H, ERROR_CORRECT_L, ERROR_CORRECT_M, ERROR_CORRECT_Q
from qrcode.image.base import BaseImage
from qrcode.image.pure import PyPNGImage
from qrcode.main import QRCode

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class QRCodeGeneratorTool(BuiltinTool):
    error_correction_levels = {
        'L': ERROR_CORRECT_L,  # <=7%
        'M': ERROR_CORRECT_M,  # <=15%
        'Q': ERROR_CORRECT_Q,  # <=25%
        'H': ERROR_CORRECT_H,  # <=30%
    }

    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any],
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        # get text content
        content = tool_parameters.get('content', '')
        if not content:
            return self.create_text_message('Invalid parameter content')

        # get border size
        border = tool_parameters.get('border', 0)
        if border < 0 or border > 100:
            return self.create_text_message('Invalid parameter border')

        # get error_correction
        error_correction = tool_parameters.get('error_correction', '')
        if error_correction not in self.error_correction_levels.keys():
            return self.create_text_message('Invalid parameter error_correction')

        try:
            image = self._generate_qrcode(content, border, error_correction)
            image_bytes = self._image_to_byte_array(image)
            return self.create_blob_message(blob=image_bytes,
                                            meta={'mime_type': 'image/png'},
                                            save_as=self.VARIABLE_KEY.IMAGE.value)
        except Exception:
            logging.exception(f'Failed to generate QR code for content: {content}')
            return self.create_text_message('Failed to generate QR code')

    def _generate_qrcode(self, content: str, border: int, error_correction: str) -> BaseImage:
        qr = QRCode(
            image_factory=PyPNGImage,
            error_correction=self.error_correction_levels.get(error_correction),
            border=border,
        )
        qr.add_data(data=content)
        qr.make(fit=True)
        img = qr.make_image()
        return img

    @staticmethod
    def _image_to_byte_array(image: BaseImage) -> bytes:
        byte_stream = io.BytesIO()
        image.save(byte_stream)
        return byte_stream.getvalue()
