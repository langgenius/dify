import tempfile
from typing import Any, Union

from core.file.enums import FileType
from core.file.file_manager import download_to_target_path
from core.rag.extractor.text_extractor import TextExtractor
from core.rag.splitter.fixed_text_splitter import FixedRecursiveCharacterTextSplitter
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolParameterValidationError
from core.tools.tool.builtin_tool import BuiltinTool


class FileExtractorTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        # image file for workflow mode
        file = tool_parameters.get("text_file")
        if file and file.type != FileType.DOCUMENT:
            raise ToolParameterValidationError("Not a valid document")

        if file:
            with tempfile.TemporaryDirectory() as temp_dir:
                file_path = download_to_target_path(file, temp_dir)
                extractor = TextExtractor(file_path, autodetect_encoding=True)
                documents = extractor.extract()
                character_splitter = FixedRecursiveCharacterTextSplitter.from_encoder(
                    chunk_size=tool_parameters.get("max_token", 500),
                    chunk_overlap=0,
                    fixed_separator=tool_parameters.get("separator", "\n\n"),
                    separators=["\n\n", "。", ". ", " ", ""],
                    embedding_model_instance=None,
                )
                chunks = character_splitter.split_documents(documents)

                content = "\n".join([chunk.page_content for chunk in chunks])
                return self.create_text_message(content)

        else:
            raise ToolParameterValidationError("Please provide either file")
