import base64
import logging
import time
from typing import Optional

from configs import dify_config
from constants import IMAGE_EXTENSIONS
from core.helper.url_signer import UrlSigner
from extensions.ext_storage import storage


class UploadFileParser:
    @classmethod
    def get_image_data(cls, upload_file, force_url: bool = False) -> Optional[str]:
        if not upload_file:
            return None

        if upload_file.extension not in IMAGE_EXTENSIONS:
            return None

        if dify_config.MULTIMODAL_SEND_FORMAT == "url" or force_url:
            return cls.get_signed_temp_image_url(upload_file.id)
        else:
            # get image file base64
            try:
                data = storage.load(upload_file.key)
            except FileNotFoundError:
                logging.exception(f"File not found: {upload_file.key}")
                return None

            encoded_string = base64.b64encode(data).decode("utf-8")
            return f"data:{upload_file.mime_type};base64,{encoded_string}"

    @classmethod
    def get_signed_temp_image_url(cls, upload_file_id) -> str:
        """
        get signed url from upload file

        :param upload_file_id: the id of UploadFile object
        :return:
        """
        base_url = dify_config.FILES_URL
        image_preview_url = f"{base_url}/files/{upload_file_id}/image-preview"

        return UrlSigner.get_signed_url(url=image_preview_url, sign_key=upload_file_id, prefix="image-preview")

    @classmethod
    def verify_image_file_signature(cls, upload_file_id: str, timestamp: str, nonce: str, sign: str) -> bool:
        """
        verify signature

        :param upload_file_id: file id
        :param timestamp: timestamp
        :param nonce: nonce
        :param sign: signature
        :return:
        """
        result = UrlSigner.verify(
            sign_key=upload_file_id, timestamp=timestamp, nonce=nonce, sign=sign, prefix="image-preview"
        )

        # verify signature
        if not result:
            return False

        current_time = int(time.time())
        return current_time - int(timestamp) <= dify_config.FILES_ACCESS_TIMEOUT
