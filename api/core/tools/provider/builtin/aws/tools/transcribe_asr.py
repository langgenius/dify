import json
import logging
import os
import re
import time
import uuid
from typing import Any, Union
from urllib.parse import urlparse

import boto3
import requests
from botocore.exceptions import ClientError
from requests.exceptions import RequestException

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


LanguageCodeOptions = [
    "af-ZA",
    "ar-AE",
    "ar-SA",
    "da-DK",
    "de-CH",
    "de-DE",
    "en-AB",
    "en-AU",
    "en-GB",
    "en-IE",
    "en-IN",
    "en-US",
    "en-WL",
    "es-ES",
    "es-US",
    "fa-IR",
    "fr-CA",
    "fr-FR",
    "he-IL",
    "hi-IN",
    "id-ID",
    "it-IT",
    "ja-JP",
    "ko-KR",
    "ms-MY",
    "nl-NL",
    "pt-BR",
    "pt-PT",
    "ru-RU",
    "ta-IN",
    "te-IN",
    "tr-TR",
    "zh-CN",
    "zh-TW",
    "th-TH",
    "en-ZA",
    "en-NZ",
    "vi-VN",
    "sv-SE",
    "ab-GE",
    "ast-ES",
    "az-AZ",
    "ba-RU",
    "be-BY",
    "bg-BG",
    "bn-IN",
    "bs-BA",
    "ca-ES",
    "ckb-IQ",
    "ckb-IR",
    "cs-CZ",
    "cy-WL",
    "el-GR",
    "et-ET",
    "eu-ES",
    "fi-FI",
    "gl-ES",
    "gu-IN",
    "ha-NG",
    "hr-HR",
    "hu-HU",
    "hy-AM",
    "is-IS",
    "ka-GE",
    "kab-DZ",
    "kk-KZ",
    "kn-IN",
    "ky-KG",
    "lg-IN",
    "lt-LT",
    "lv-LV",
    "mhr-RU",
    "mi-NZ",
    "mk-MK",
    "ml-IN",
    "mn-MN",
    "mr-IN",
    "mt-MT",
    "no-NO",
    "or-IN",
    "pa-IN",
    "pl-PL",
    "ps-AF",
    "ro-RO",
    "rw-RW",
    "si-LK",
    "sk-SK",
    "sl-SI",
    "so-SO",
    "sr-RS",
    "su-ID",
    "sw-BI",
    "sw-KE",
    "sw-RW",
    "sw-TZ",
    "sw-UG",
    "tl-PH",
    "tt-RU",
    "ug-CN",
    "uk-UA",
    "uz-UZ",
    "wo-SN",
    "zu-ZA",
]

MediaFormat = ["mp3", "mp4", "wav", "flac", "ogg", "amr", "webm", "m4a"]


def is_url(text):
    if not text:
        return False
    text = text.strip()
    # Regular expression pattern for URL validation
    pattern = re.compile(
        r"^"  # Start of the string
        r"(?:http|https)://"  # Protocol (http or https)
        r"(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+(?:[A-Z]{2,6}\.?|[A-Z0-9-]{2,}\.?)|"  # Domain
        r"localhost|"  # localhost
        r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})"  # IP address
        r"(?::\d+)?"  # Optional port
        r"(?:/?|[/?]\S+)"  # Path
        r"$",  # End of the string
        re.IGNORECASE,
    )
    return bool(pattern.match(text))


def upload_file_from_url_to_s3(s3_client, url, bucket_name, s3_key=None, max_retries=3):
    """
    Upload a file from a URL to an S3 bucket with retries and better error handling.

    Parameters:
    - s3_client
    - url (str): The URL of the file to upload
    - bucket_name (str): The name of the S3 bucket
    - s3_key (str): The desired key (path) in S3. If None, will use the filename from URL
    - max_retries (int): Maximum number of retry attempts

    Returns:
    - tuple: (bool, str) - (Success status, Message)
    """

    # Validate inputs
    if not url or not bucket_name:
        return False, "URL and bucket name are required"

    retry_count = 0
    while retry_count < max_retries:
        try:
            # Download the file from URL
            response = requests.get(url, stream=True, timeout=30)
            response.raise_for_status()

            # If s3_key is not provided, try to get filename from URL
            if not s3_key:
                parsed_url = urlparse(url)
                filename = os.path.basename(parsed_url.path.split("/file-preview")[0])
                s3_key = "transcribe-files/" + filename

            # Upload the file to S3
            s3_client.upload_fileobj(
                response.raw,
                bucket_name,
                s3_key,
                ExtraArgs={
                    "ContentType": response.headers.get("content-type"),
                    "ACL": "private",  # Ensure the uploaded file is private
                },
            )

            return f"s3://{bucket_name}/{s3_key}", f"Successfully uploaded file to s3://{bucket_name}/{s3_key}"

        except RequestException as e:
            retry_count += 1
            if retry_count == max_retries:
                return None, f"Failed to download file from URL after {max_retries} attempts: {str(e)}"
            continue

        except ClientError as e:
            return None, f"AWS S3 error: {str(e)}"

        except Exception as e:
            return None, f"Unexpected error: {str(e)}"

    return None, "Maximum retries exceeded"


class TranscribeTool(BuiltinTool):
    s3_client: Any = None
    transcribe_client: Any = None

    """
    Note that you must include one of LanguageCode, IdentifyLanguage,
    or IdentifyMultipleLanguages in your request. 
    If you include more than one of these parameters, your transcription job fails.
    """

    def _transcribe_audio(self, audio_file_uri, file_type, **extra_args):
        uuid_str = str(uuid.uuid4())
        job_name = f"{int(time.time())}-{uuid_str}"
        try:
            # Start transcription job
            response = self.transcribe_client.start_transcription_job(
                TranscriptionJobName=job_name, Media={"MediaFileUri": audio_file_uri}, **extra_args
            )

            # Wait for the job to complete
            while True:
                status = self.transcribe_client.get_transcription_job(TranscriptionJobName=job_name)
                if status["TranscriptionJob"]["TranscriptionJobStatus"] in ["COMPLETED", "FAILED"]:
                    break
                time.sleep(5)

            if status["TranscriptionJob"]["TranscriptionJobStatus"] == "COMPLETED":
                return status["TranscriptionJob"]["Transcript"]["TranscriptFileUri"], None
            else:
                return None, f"Error: TranscriptionJobStatus:{status['TranscriptionJob']['TranscriptionJobStatus']} "

        except Exception as e:
            return None, f"Error: {str(e)}"

    def _download_and_read_transcript(self, transcript_file_uri: str, max_retries: int = 3) -> tuple[str, str]:
        """
        Download and read the transcript file from the given URI.

        Parameters:
        - transcript_file_uri (str): The URI of the transcript file
        - max_retries (int): Maximum number of retry attempts

        Returns:
        - tuple: (text, error) - (Transcribed text if successful, error message if failed)
        """
        retry_count = 0
        while retry_count < max_retries:
            try:
                # Download the transcript file
                response = requests.get(transcript_file_uri, timeout=30)
                response.raise_for_status()

                # Parse the JSON content
                transcript_data = response.json()

                # Check if speaker labels are present and enabled
                has_speaker_labels = (
                    "results" in transcript_data
                    and "speaker_labels" in transcript_data["results"]
                    and "segments" in transcript_data["results"]["speaker_labels"]
                )

                if has_speaker_labels:
                    # Get speaker segments
                    segments = transcript_data["results"]["speaker_labels"]["segments"]
                    items = transcript_data["results"]["items"]

                    # Create a mapping of start_time -> speaker_label
                    time_to_speaker = {}
                    for segment in segments:
                        speaker_label = segment["speaker_label"]
                        for item in segment["items"]:
                            time_to_speaker[item["start_time"]] = speaker_label

                    # Build transcript with speaker labels
                    current_speaker = None
                    transcript_parts = []

                    for item in items:
                        # Skip non-pronunciation items (like punctuation)
                        if item["type"] == "punctuation":
                            transcript_parts.append(item["alternatives"][0]["content"])
                            continue

                        start_time = item["start_time"]
                        speaker = time_to_speaker.get(start_time)

                        if speaker != current_speaker:
                            current_speaker = speaker
                            transcript_parts.append(f"\n[{speaker}]: ")

                        transcript_parts.append(item["alternatives"][0]["content"])

                    return " ".join(transcript_parts).strip(), None
                else:
                    # Extract the transcription text
                    # The transcript text is typically in the 'results' -> 'transcripts' array
                    if "results" in transcript_data and "transcripts" in transcript_data["results"]:
                        transcripts = transcript_data["results"]["transcripts"]
                        if transcripts:
                            # Combine all transcript segments
                            full_text = " ".join(t.get("transcript", "") for t in transcripts)
                            return full_text, None

                return None, "No transcripts found in the response"

            except requests.exceptions.RequestException as e:
                retry_count += 1
                if retry_count == max_retries:
                    return None, f"Failed to download transcript file after {max_retries} attempts: {str(e)}"
                continue

            except json.JSONDecodeError as e:
                return None, f"Failed to parse transcript JSON: {str(e)}"

            except Exception as e:
                return None, f"Unexpected error while processing transcript: {str(e)}"

        return None, "Maximum retries exceeded"

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        try:
            if not self.transcribe_client:
                aws_region = tool_parameters.get("aws_region")
                if aws_region:
                    self.transcribe_client = boto3.client("transcribe", region_name=aws_region)
                    self.s3_client = boto3.client("s3", region_name=aws_region)
                else:
                    self.transcribe_client = boto3.client("transcribe")
                    self.s3_client = boto3.client("s3")

            file_url = tool_parameters.get("file_url")
            file_type = tool_parameters.get("file_type")
            language_code = tool_parameters.get("language_code")
            identify_language = tool_parameters.get("identify_language", True)
            identify_multiple_languages = tool_parameters.get("identify_multiple_languages", False)
            language_options_str = tool_parameters.get("language_options")
            s3_bucket_name = tool_parameters.get("s3_bucket_name")
            ShowSpeakerLabels = tool_parameters.get("ShowSpeakerLabels", True)
            MaxSpeakerLabels = tool_parameters.get("MaxSpeakerLabels", 2)

            # Check the input params
            if not s3_bucket_name:
                return self.create_text_message(text="s3_bucket_name is required")
            language_options = None
            if language_options_str:
                language_options = language_options_str.split("|")
                for lang in language_options:
                    if lang not in LanguageCodeOptions:
                        return self.create_text_message(
                            text=f"{lang} is not supported, should be one of {LanguageCodeOptions}"
                        )
            if language_code and language_code not in LanguageCodeOptions:
                err_msg = f"language_code:{language_code} is not supported, should be one of {LanguageCodeOptions}"
                return self.create_text_message(text=err_msg)

            err_msg = f"identify_language:{identify_language}, \
                identify_multiple_languages:{identify_multiple_languages}, \
                Note that you must include one of LanguageCode, IdentifyLanguage, \
                or IdentifyMultipleLanguages in your request. \
                If you include more than one of these parameters, \
                your transcription job fails."
            if not language_code:
                if identify_language and identify_multiple_languages:
                    return self.create_text_message(text=err_msg)
            else:
                if identify_language or identify_multiple_languages:
                    return self.create_text_message(text=err_msg)

            extra_args = {
                "IdentifyLanguage": identify_language,
                "IdentifyMultipleLanguages": identify_multiple_languages,
            }
            if language_code:
                extra_args["LanguageCode"] = language_code
            if language_options:
                extra_args["LanguageOptions"] = language_options
            if ShowSpeakerLabels:
                extra_args["Settings"] = {"ShowSpeakerLabels": ShowSpeakerLabels, "MaxSpeakerLabels": MaxSpeakerLabels}

            # upload to s3 bucket
            s3_path_result, error = upload_file_from_url_to_s3(self.s3_client, url=file_url, bucket_name=s3_bucket_name)
            if not s3_path_result:
                return self.create_text_message(text=error)

            transcript_file_uri, error = self._transcribe_audio(
                audio_file_uri=s3_path_result,
                file_type=file_type,
                **extra_args,
            )
            if not transcript_file_uri:
                return self.create_text_message(text=error)

            # Download and read the transcript
            transcript_text, error = self._download_and_read_transcript(transcript_file_uri)
            if not transcript_text:
                return self.create_text_message(text=error)

            return self.create_text_message(text=transcript_text)

        except Exception as e:
            return self.create_text_message(f"Exception {str(e)}")
