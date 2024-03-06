import io
import logging
from typing import Any, Union

import qrcode
from qrcode.image.pure import PyPNGImage

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class QRCodeGeneratorTool(BuiltinTool):
    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any],
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        # get expression
        content = tool_parameters.get('content', '')
        if not content:
            return self.create_text_message('Invalid parameter content')

        try:
            img = qrcode.make(data=content, image_factory=PyPNGImage)
            byte_stream = io.BytesIO()
            img.save(byte_stream)
            byte_array = byte_stream.getvalue()
            return self.create_blob_message(blob=byte_array,
                                            meta={'mime_type': 'image/png'},
                                            save_as=self.VARIABLE_KEY.IMAGE.value)
        except Exception:
            logging.exception(f'Failed to generate QR code for content: {content}')
            return self.create_text_message('Failed to generate QR code')
