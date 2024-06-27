from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

from core.tools.tool_file_manager import ToolFileManager
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from models.tools import BuiltinToolProvider
from mimetypes import guess_extension, guess_type
from flask_login import current_user

import requests
from PIL import Image
from io import BytesIO
import base64
import json
from extensions.ext_storage import storage
import uuid
import hashlib

from os import path

class ImageLoaderConvertUrlTool(BuiltinTool):
    """
    
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> list[ToolInvokeMessage]:
        url = tool_parameters.get('url')
        # image_bytes = self.download_image(url)
        # image_b64_json = self.image_to_b64_json(image_bytes)
        # decoded_bytes = self.b64_json_to_bytes(image_b64_json)

        result = []

        tenant_id = current_user.current_tenant_id or "tenant_id"

        response = requests.get(url, stream=True)
        if response.status_code == 200:
            image_ext = guess_extension(response.headers['Content-Type'])
            filename = url.split('/')[-1]
            if '.' in filename:
                filename, _ = path.splitext(filename)

            filename = self.generate_fixed_uuid4(filename)

            print("ImageLoaderConvertUrlTool")
            print(filename)

            file_key = f"tools/{tenant_id}/{filename}{image_ext}"
            mime_type, _ = guess_type(file_key)
            if not storage.exists(file_key):
                storage.save(file_key, response.content)

            file = ToolFileManager.create_file_by_key(
                id=filename,
                user_id=user_id, 
                tenant_id=tenant_id,
                conversation_id=None,
                file_key=file_key,
                mimetype=mime_type
            )

            # sign_url = ToolFileManager.sign_file(file.file_key, image_ext)

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

    def image_to_b64_json(self, image_bytes):
        image = Image.open(BytesIO(image_bytes))
        buffered = BytesIO()
        
        # 这里假设要转换为PNG格式
        image.save(buffered, format="PNG")
        img_b64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
        
        # 转换为JSON格式
        img_b64_json = json.dumps({"b64_json": img_b64})
        return img_b64_json

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
