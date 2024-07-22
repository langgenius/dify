import base64
import hashlib
import json
import re
import uuid
from io import BytesIO
from mimetypes import guess_type
from typing import Any

import requests
from PIL import Image

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.tool_file_manager import ToolFileManager
from extensions.ext_storage import storage


class ImageLoaderConvertBase64Tool(BuiltinTool):
    """
    
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> list[ToolInvokeMessage]:
        base64String = tool_parameters.get('base64String')
        print(tool_parameters)
        # image_bytes = self.download_image(url)
        if not isinstance(base64String, str):
            raise ToolInvokeError("Convert failed!")

        result = []

        tenant_id = self.generate_fixed_uuid4("image_files_local_storage")

        image_ext = f".{self.get_image_format(base64String)}"

        filename = self.generate_fixed_uuid4(base64String)

        file_key = f"tools/{tenant_id}/{filename}{image_ext}"
        mime_type, _ = guess_type(file_key)
        if not storage.exists(file_key):
            img_bytes = self.image_to_b64(base64String)
            storage.save(file_key, img_bytes)

            # sign_url = ToolFileManager.sign_file(file.file_key, image_ext)

        _ = ToolFileManager.create_file_by_key(
            id=filename,
            user_id=user_id, 
            tenant_id=tenant_id,
            conversation_id=None,
            file_key=file_key,
            mimetype=mime_type
        )

        url = f"https://dify.ddit.ai/{file_key}"

        meta = { 
            "url": url,
            "tool_file_id": filename
        }

        msg = ToolInvokeMessage(type=ToolInvokeMessage.MessageType.IMAGE_LINK,
                                message=url,
                                save_as=filename,
                                meta=meta)
        
        result.append(msg)


        # result = []
        # result.append(self.create_blob_message(blob=decoded_bytes,
        #                                            meta={'mime_type': 'image/png'},
        #                                            save_as=self.VARIABLE_KEY.IMAGE.value))


        

        # ToolFileManager.create_file_by_url(current_user.id, current_user.current_tenant_id, file_url=message.message)
        # extension = guess_extension(file.mimetype) or '.png'
        # sign_url = ToolFileManager.sign_file(file.file_key, extension)

        # meta = { "url": sign_url }
        # msg = ToolInvokeMessage(type=ToolInvokeMessage.MessageType.IMAGE_LINK,
        #                         message=sign_url,
        #                         save_as='',
        #                         meta=meta)
        
        # result = []
        # result.append(msg)
        return result

    def download_image(self, url):
        response = requests.get(url)
        response.raise_for_status()  # 确保请求成功
        return response.content

    def get_image_format(self, base64String):
        # 使用正则表达式识别图像格式
        match = re.match(r'data:image/(.*?);base64', base64String)
        if match:
            return match.group(1).lower()
        return "png"

    def image_to_b64(self, base64String):
        # 移除可能存在的头部信息
        if base64String.startswith('data:image'):
            format = self.get_image_format(base64String)
            base64String = base64String.split(',')[1]
        else:
            format = "png"  # 默认格式为PNG

        image_bytes = base64.b64decode(base64String)
        image = Image.open(BytesIO(image_bytes))
        buffered = BytesIO()

        # 将图像保存为识别格式
        image.save(buffered, format=format)
        return buffered.getvalue()

    def b64_json_to_bytes(self, b64_json):
        img_b64 = json.loads(b64_json)["b64_json"]
        return base64.b64decode(img_b64)

    def generate_fixed_uuid4(self, input_string):
        # 使用SHA-1哈希函数生成一个哈希值
        hash_object = hashlib.sha1(input_string.encode())
        hash_hex = hash_object.hexdigest()
        
        # 取前16个字节生成UUID
        uuid_hex = hash_hex[:32]
        return str(uuid.UUID(uuid_hex))
