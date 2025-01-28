from typing import Any, Dict, List, Union
import base64
import requests
import json
import logging

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.tool_file_manager import ToolFileManager
from extensions.ext_storage import storage
from core.file.models import File
from core.file.file_manager import download

logger = logging.getLogger(__name__)

class URLToBase64Converter(BuiltinTool):
    def _invoke(self, 
                user_id: str, 
                tool_parameters: Dict[str, Any],
        ) -> ToolInvokeMessage:
        """
        Конвертирует файл в base64 строку.
        Поддерживает как внешние URL, так и локальные файлы Dify.
        """
        logger.info(f"Received parameters: {tool_parameters}")
        
        # Получаем источник файла
        file_source = tool_parameters.get('file_source')
        if not file_source:
            return self.create_text_message('Please specify file source (url or local)')

        try:
            # Обработка внешнего URL
            if file_source == 'url':
                url = tool_parameters.get('url')
                if not url:
                    return self.create_text_message('Please provide a URL')
                
                response = requests.get(url)
                response.raise_for_status()
                content = response.content
                
            # Обработка локального файла Dify
            elif file_source == 'local':
                file = tool_parameters.get('file')
                logger.info(f"File data: {file}")
                
                if not file:
                    return self.create_text_message('Please provide a file')
                
                if not isinstance(file, File):
                    logger.error(f"Invalid file type: {type(file)}")
                    return self.create_text_message('Invalid file type. Expected Dify File object')
                
                # Загружаем содержимое файла
                content = download(file)
                if not content:
                    logger.error("Failed to download file content")
                    return self.create_text_message('Failed to download file content')
                
                logger.info(f"Successfully loaded file: {len(content)} bytes")
            
            else:
                return self.create_text_message('Invalid file source. Use "url" or "local"')
            
            # Конвертируем содержимое в base64
            base64_content = base64.b64encode(content).decode('utf-8')
            logger.info(f"Successfully converted file to base64: {len(base64_content)} characters")
            return self.create_text_message(base64_content)
            
        except Exception as e:
            logger.exception("Error processing file")
            return self.create_text_message(f'Error processing file: {str(e)}')
