import logging
import os
import tempfile
from typing import Optional

import click
import cv2
import numpy as np
from skimage.metrics import structural_similarity as ssim

from extensions.ext_storage import storage
from models.model import UploadFile
from services.errors.video import FailedToWriteImageError, NoVideoUploadedServiceError, VideoNokeyframesExtractedError


class ExtractVideoFrames:
    def __init__(self, file: UploadFile, max_collect_frames: int = 20,
                 similarity_threshold: Optional[float] = 0.7, blur_threshold: Optional[int] = 500):
        self.file_key = file.key
        self.max_collect_frames = max_collect_frames                # Threshold of the number of key frames to extract
        self.similarity_threshold = similarity_threshold            # Similarity threshold, less than this value is considered to be similar frames
        self.blur_threshold = blur_threshold                        # Fuzzy threshold. If it is larger than this value, it is considered a fuzzy frame

    @staticmethod
    def extract_frames(interval: float, video_file: str):
        """
        Extract frames from video file.
        :param video_file:
        :param interval:
        :return:
        """
        try:
            vidcap = cv2.VideoCapture(video_file)
            if not vidcap.isOpened():
                raise ValueError(f"Could not open video file '{video_file}'.")

            fps = vidcap.get(cv2.CAP_PROP_FPS)
            total_frames = int(vidcap.get(cv2.CAP_PROP_FRAME_COUNT))
            frames_per_chunk = int(interval * fps)  # Adjust this value to change the number of frames per chunk

            for start_frame in range(0, total_frames, frames_per_chunk):
                vidcap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)  # Set the position of the next frame to read
                frames = []
                count = 0
                while count < frames_per_chunk:
                    success, image = vidcap.read()
                    if not success:
                        break
                    if count % (interval * fps) == 0:
                        frames.append(image)
                    count += 1

                if frames:  # Yield remaining frames if any.
                    yield frames

            vidcap.release()
        except Exception as e:
            raise ValueError(f"video frame extraction failed. Error: {str(e)}")

    @staticmethod
    def ssim_calculate_similarity(frame1, frame2):
        """
        Calculate SSIM between two frames.
        :param frame1:
        :param frame2:
        :return:
        """
        frame1_gray = cv2.cvtColor(frame1, cv2.COLOR_BGR2GRAY)
        frame2_gray = cv2.cvtColor(frame2, cv2.COLOR_BGR2GRAY)
        score = ssim(frame1_gray, frame2_gray)
        return score

    @staticmethod
    def calculate_blur_score(frame):
        """
        Calculate blur score of a frame.
        :param frame:
        :return:
        """
        gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        return cv2.Laplacian(gray_frame, cv2.CV_64F).var()

    @staticmethod
    def is_blank_frame(frame, threshold=0.99):
        """
        Check if frame is blank.
        :param frame:
        :param threshold:
        :return:
        """
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        hist = cv2.calcHist([gray], [0], None, [256], [0, 256])
        total_pixels = frame.shape[0] * frame.shape[1]
        white_pixels = hist[-1]
        black_pixels = hist[0]

        if (white_pixels / total_pixels) > threshold:
            return True  # The frame is all white
        elif (black_pixels / total_pixels) > threshold:
            return True  # The frame is all black
        else:
            return False

    def filter_frames(self, frames):
        """
        Filter the
            1. Filtered similar frame
            2. Filtered fuzzy frame
            3. Filtered blank frame
        :param frames:
        :return:
        """
        prev_frame = None
        filtered_frames = list()

        for i, frame in enumerate(frames):
            if prev_frame is not None:
                ssim_similarity_score = self.ssim_calculate_similarity(prev_frame, frame)
                blur_score = self.calculate_blur_score(frame)
                # logging.info(click.style(f"SSIM Similarity score: {ssim_similarity_score}, Blur score: {blur_score}", fg='green'))
                if ssim_similarity_score < self.similarity_threshold and not self.is_blank_frame(frame) and blur_score < self.blur_threshold:
                    filtered_frames.append(frame)
                elif i % 3 == 0:
                    if not self.is_blank_frame(frame) and blur_score < self.blur_threshold:
                        filtered_frames.append(frame)
            else:
                prev_frame = frame
                filtered_frames.append(frame)  # Add header frame

        filtered_frames.append(frames[-1])  # Add end frame
        return filtered_frames

    @staticmethod
    def stitch_frames(frames):
        """
        Stitch frames horizontally.
        :param frames:
        :return:
        """
        stitched_image = None
        for frame in frames:
            if stitched_image is None:
                stitched_image = frame
            else:
                stitched_image = np.hstack((stitched_image, frame))
        return stitched_image

    @staticmethod
    def save_stitched_image(stitched_image, file_path) -> None:
        """
        Save the stitched image to the output path.
        :param stitched_image:
        :param file_path:
        :return:
        """
        try:
            cv2.imwrite(file_path, stitched_image, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
        except cv2.error as e:
            raise FailedToWriteImageError(str(e))

    def process_video(self) -> bytes:
        """
        Process the uploaded video file.
        :return:
        """
        # Download the video file to local temp directory
        with tempfile.TemporaryDirectory() as temp_dir:
            video_file = temp_dir + '/' + os.path.basename(self.file_key)
            file_name = os.path.basename(video_file).split('.')[0]
            video_image = temp_dir + '/' + file_name + '.jpg'

            if not os.path.isfile(video_file):
                storage.download(filename=self.file_key, target_filepath=video_file)

            if not os.path.isfile(video_file):
                raise NoVideoUploadedServiceError()

            temp_keyframes = list()
            interval = 1    # Keyframe extraction interval

            # Video frame extraction
            for frames in self.extract_frames(interval=interval, video_file=video_file):
                temp_keyframes.extend(frames)

            while True:
                keyframes = self.filter_frames(frames=temp_keyframes)

                # Key frame extraction, the total number of extracted frames exceeds the threshold, and the time interval is increased by 0.5s
                if len(keyframes) > self.max_collect_frames:
                    keyframes.clear()
                    temp_keyframes.clear()
                    interval += 0.5
                    for frames in self.extract_frames(interval=interval, video_file=video_file):
                        temp_keyframes.extend(frames)
                else:
                    break

            if len(keyframes) == 0:
                raise VideoNokeyframesExtractedError()

            # stitched image frame
            logging.info(click.style(f"extracted frames count: {len(keyframes)}", fg='green'))
            stitched_image = self.stitch_frames(keyframes)
            self.save_stitched_image(stitched_image, file_path=video_image)
            with open(video_image, 'rb') as image_file:
                stitched_image_content = image_file.read()
            return stitched_image_content
