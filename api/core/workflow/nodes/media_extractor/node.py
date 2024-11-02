import logging
import time
from typing import Optional

import click

from core.file import File, FileTransferMethod, file_repository
from core.file.models import FileType
from core.helper import ssrf_proxy
from core.variables import ArrayFileSegment
from core.variables.segments import FileSegment
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from extensions.ext_database import db
from models.account import Account
from models.model import App, UploadFile
from models.workflow import WorkflowNodeExecutionStatus
from services.audio_service import AudioService
from services.extract_video_frames import ExtractVideoFrames
from services.file_service import FileService

from .entities import MediaExtractorNodeData
from .exc import FileDownloadError, MediaExtractorError, UnsupportedFileTypeError


class MediaExtractorNode(BaseNode[MediaExtractorNodeData]):
    """
    Extracts text and image content from various file types.
    Supports audio、video files.
    """

    _node_data_cls = MediaExtractorNodeData
    _node_type = NodeType.MEDIA_EXTRACTOR

    def _run(self):
        variable_selector = self.node_data.variable_selector
        variable = self.graph_runtime_state.variable_pool.get(variable_selector)
        self.app_model = db.session.query(App).filter(App.id == self.app_id).first()
        self.user = db.session.query(Account).filter(Account.id == self.user_id).first()

        if variable is None:
            error_message = f"File variable not found for selector: {variable_selector}"
            return NodeRunResult(status=WorkflowNodeExecutionStatus.FAILED, error=error_message)
        if variable.value and not isinstance(variable, ArrayFileSegment | FileSegment):
            error_message = f"Variable {variable_selector} is not an ArrayFileSegment"
            return NodeRunResult(status=WorkflowNodeExecutionStatus.FAILED, error=error_message)

        value = variable.value
        process_data = {"media": value if isinstance(value, list) else [value]}
        inputs = {"variable_selector": variable_selector, "variable_config": self.node_data.variable_config}

        try:
            if isinstance(value, list) and len(value) > 0:
                extracted_obj = self._extract_content_from_video(value[0])
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs=inputs,
                    process_data=process_data,
                    outputs=extracted_obj,
                )
            elif isinstance(value, File):
                extracted_obj = self._extract_content_from_video(value)
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs=inputs,
                    process_data=process_data,
                    outputs=extracted_obj,
                )
            else:
                raise MediaExtractorError(f"Unsupported variable type: {type(value)}")
        except MediaExtractorError as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e),
                inputs=inputs,
                process_data=process_data,
            )

    def _extract_content_from_video(self, file: File):
        if file.mime_type is None:
            raise UnsupportedFileTypeError("Unable to determine file type: MIME type is missing")

        audio_text = None
        video_images = []
        upload_file = self._download_upload_file(file)
        extract_audio = self.node_data.variable_config.get("extract_audio")
        extract_video = self.node_data.variable_config.get("extract_video")
        word_timestamps = self.node_data.variable_config.get("word_timestamps")

        if extract_audio == "enabled":
            audio_text = self._extract_text_from_audio(
                file=upload_file, timestamp=word_timestamps, app_model=self.app_model
            )

        if extract_video == "enabled":
            video_images = self._extract_images_from_video(file=upload_file)

        return {"text": audio_text.get("text") if isinstance(audio_text, dict) else None, "images": video_images}

    @staticmethod
    def _download_upload_file(file: File) -> UploadFile:
        """Download the content of a file based on its transfer method."""
        try:
            if file.transfer_method == FileTransferMethod.REMOTE_URL:
                if file.remote_url is None:
                    raise FileDownloadError("Missing URL for remote file")
                response = ssrf_proxy.get(file.remote_url)
                response.raise_for_status()

                upload_file = file_repository.get_upload_file(session=db.session(), file=response.content)
                return upload_file
            elif file.transfer_method == FileTransferMethod.LOCAL_FILE:
                upload_file = file_repository.get_upload_file(session=db.session(), file=file)
                return upload_file
            else:
                raise ValueError(f"Unsupported transfer method: {file.transfer_method}")
        except Exception as e:
            raise FileDownloadError(f"Error downloading file: {str(e)}") from e

    @staticmethod
    def _extract_text_from_audio(file: UploadFile, app_model, timestamp) -> Optional[str]:
        """
        Get video text data
        :return:
        """
        return AudioService.transcript_asr(file=file, app_model=app_model)

    def _extract_images_from_video(self, file: UploadFile) -> list:
        """Extract text from a file based on its MIME type."""
        video_config = self.node_data.variable_config

        # Video frame extraction and audio extraction
        if video_config["extract_video"] == "enabled":
            images = []
            start = time.perf_counter()
            video_obj = ExtractVideoFrames(
                max_collect_frames=video_config["max_collect_frames"],
                similarity_threshold=video_config["similarity_threshold"],
                blur_threshold=video_config["blur_threshold"],
                splice_mode=video_config["splice_mode"],
                file=file,
            ).process_video()
            if video_config["splice_mode"] == "images":
                for video_image in video_obj:
                    image_upload_file = FileService.upload_file(
                        content=video_image.read(),
                        user=self.user,
                        filename=f'{file.name.split(".")[0]}.jpeg',
                        mimetype="image/jpeg",
                    )
                    images.append(
                        File(
                            tenant_id=image_upload_file.tenant_id,
                            type=FileType.IMAGE,
                            transfer_method=FileTransferMethod.LOCAL_FILE,
                            remote_url=None,
                            related_id=image_upload_file.id,
                            filename=image_upload_file.name,
                            extension=image_upload_file.extension,
                            mime_type=image_upload_file.mime_type,
                            size=image_upload_file.size,
                        )
                    )
            else:
                image_upload_file = FileService.upload_file(
                    content=video_obj, user=self.user, filename=f'{file.name.split(".")[0]}.jpeg', mimetype="image/jpeg"
                )
                images.append(
                    File(
                        tenant_id=image_upload_file.tenant_id,
                        type=FileType.IMAGE,
                        transfer_method=FileTransferMethod.LOCAL_FILE,
                        filename=image_upload_file.name,
                        related_id=image_upload_file.id,
                        extension=image_upload_file.extension,
                        mime_type=image_upload_file.mime_type,
                        size=image_upload_file.size,
                    )
                )

            end = time.perf_counter()
            elapsed_time = float(f"{end - start:0.4f}")
            logging.debug(
                click.style(
                    f"{file.size / 1024 / 1024:.2f}M video frame extraction to image time-consuming {elapsed_time}s.",
                    fg="green",
                )
            )
            return images
