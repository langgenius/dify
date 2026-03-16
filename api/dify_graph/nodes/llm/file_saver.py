import mimetypes
import typing as tp

from dify_graph.file import File, FileTransferMethod, FileType
from dify_graph.file.constants import DEFAULT_EXTENSION, DEFAULT_MIME_TYPE
from dify_graph.nodes.protocols import FileReferenceFactoryProtocol, HttpClientProtocol, ToolFileManagerProtocol


class LLMFileSaver(tp.Protocol):
    """LLMFileSaver is responsible for save multimodal output returned by
    LLM.
    """

    def save_binary_string(
        self,
        data: bytes,
        mime_type: str,
        file_type: FileType,
        extension_override: str | None = None,
    ) -> File:
        """save_binary_string saves the inline file data returned by LLM.

        Currently (2025-04-30), only some of Google Gemini models will return
        multimodal output as inline data.

        :param data: the contents of the file
        :param mime_type: the media type of the file, specified by rfc6838
            (https://datatracker.ietf.org/doc/html/rfc6838)
        :param file_type: The file type of the inline file.
        :param extension_override: Override the auto-detected file extension while saving this file.

            The default value is `None`, which means do not override the file extension and guessing it
            from the `mime_type` attribute while saving the file.

            Setting it to values other than `None` means override the file's extension, and
            will bypass the extension guessing saving the file.

            Specially, setting it to empty string (`""`) will leave the file extension empty.

            When it is not `None` or empty string (`""`), it should be a string beginning with a
            dot (`.`). For example, `.py` and `.tar.gz` are both valid values, while `py`
            and `tar.gz` are not.
        """
        raise NotImplementedError()

    def save_remote_url(self, url: str, file_type: FileType) -> File:
        """save_remote_url saves the file from a remote url returned by LLM.

        Currently (2025-04-30), no model returns multimodel output as a url.

        :param url: the url of the file.
        :param file_type: the file type of the file, check `FileType` enum for reference.
        """
        raise NotImplementedError()


class FileSaverImpl(LLMFileSaver):
    _tool_file_manager: ToolFileManagerProtocol
    _file_reference_factory: FileReferenceFactoryProtocol

    def __init__(
        self,
        *,
        tool_file_manager: ToolFileManagerProtocol,
        file_reference_factory: FileReferenceFactoryProtocol,
        http_client: HttpClientProtocol,
    ):
        self._tool_file_manager = tool_file_manager
        self._file_reference_factory = file_reference_factory
        self._http_client = http_client

    def save_remote_url(self, url: str, file_type: FileType) -> File:
        http_response = self._http_client.get(url)
        http_response.raise_for_status()
        data = http_response.content
        mime_type_from_header = http_response.headers.get("Content-Type")
        mime_type, extension = _extract_content_type_and_extension(url, mime_type_from_header)
        return self.save_binary_string(data, mime_type, file_type, extension_override=extension)

    def save_binary_string(
        self,
        data: bytes,
        mime_type: str,
        file_type: FileType,
        extension_override: str | None = None,
    ) -> File:
        tool_file = self._tool_file_manager.create_file_by_raw(
            file_binary=data,
            mimetype=mime_type,
        )
        extension_override = _validate_extension_override(extension_override)
        extension = _get_extension(mime_type, extension_override)
        return self._file_reference_factory.build_from_mapping(
            mapping={
                "type": file_type,
                "transfer_method": FileTransferMethod.TOOL_FILE,
                "filename": tool_file.name,
                "extension": extension,
                "mime_type": mime_type,
                "size": len(data),
                "tool_file_id": str(tool_file.id),
            }
        )


def _get_extension(mime_type: str, extension_override: str | None = None) -> str:
    """get_extension return the extension of file.

    If the `extension_override` parameter is set, this function should honor it and
    return its value.
    """
    if extension_override is not None:
        return extension_override
    return mimetypes.guess_extension(mime_type) or DEFAULT_EXTENSION


def _extract_content_type_and_extension(url: str, content_type_header: str | None) -> tuple[str, str]:
    """_extract_content_type_and_extension tries to
    guess content type of file from url and `Content-Type` header in response.
    """
    if content_type_header:
        extension = mimetypes.guess_extension(content_type_header) or DEFAULT_EXTENSION
        return content_type_header, extension
    content_type = mimetypes.guess_type(url)[0] or DEFAULT_MIME_TYPE
    extension = mimetypes.guess_extension(content_type) or DEFAULT_EXTENSION
    return content_type, extension


def _validate_extension_override(extension_override: str | None) -> str | None:
    # `extension_override` is allow to be `None or `""`.
    if extension_override is None:
        return None
    if extension_override == "":
        return ""
    if not extension_override.startswith("."):
        raise ValueError("extension_override should start with '.' if not None or empty.", extension_override)
    return extension_override
