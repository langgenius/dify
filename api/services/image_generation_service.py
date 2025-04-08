from enum import Enum

from configs import dify_config
from core.tools.tool_file_manager import ToolFileManager
from extensions.ext_database import db
from libs.helper import RateLimiter
from libs.infinite_scroll_pagination import MultiPagePagination
from models.model import EndUser, UserGeneratedImage
from tasks.image_generation_task import generate_image_task


# define string enum for content_type
class ContentType(str, Enum):
    SELF_MESSAGE = "self_message"
    SUMMARY_ADVICE = "summary_advice"


DEFAULT_IMAGE_EXTENSION = ".png"


class ImageGenerationService:

    generate_image_rate_limiter = RateLimiter(
        prefix="generate_image_rate_limit", max_attempts=dify_config.IMAGE_GENERATION_DAILY_LIMIT, time_window=86400 * 1
    )

    @staticmethod
    def generate_image(end_user: EndUser, content_type: ContentType) -> str:
        """
        Initiates asynchronous image generation process and creates a pending image record

        Args:
            end_user: End user object
            content_type: Type of content to generate

        Returns:
            The ID of the created UserGeneratedImage entity that will be updated by the task
        """
        # Check if rate limited before submitting task
        if ImageGenerationService.generate_image_rate_limiter.is_rate_limited(end_user.id):
            raise Exception("Image generation rate limit exceeded")

        # Create a pending UserGeneratedImage entity
        user_generated_image = UserGeneratedImage(
            app_id=end_user.app_id,
            end_user_id=end_user.id,
            content_type=content_type,
            status="pending",  # Set initial status to pending
        )

        db.session.add(user_generated_image)
        db.session.commit()

        # Get the generated ID for tracking
        image_id = str(user_generated_image.id)

        # Submit the task asynchronously with the image_id
        generate_image_task.delay(end_user_id=str(end_user.id), content_type=content_type, image_id=image_id)

        # Return the image ID as a reference for status checking
        return image_id

    @staticmethod
    def pagination_image_list(end_user: EndUser, limit: int, offset: int) -> MultiPagePagination:

        query = (
            db.session.query(UserGeneratedImage)
            .filter(UserGeneratedImage.app_id == end_user.app_id, UserGeneratedImage.end_user_id == end_user.id)
            .order_by(UserGeneratedImage.created_at.desc())
        )

        total_count = query.count()
        images = query.limit(limit).offset(offset).all()

        # sign file with file_id to get a temporary url
        for image in images:
            if image.file_id:
                image.image_url = ToolFileManager.sign_file(image.file_id, DEFAULT_IMAGE_EXTENSION)

        return MultiPagePagination(data=images, total=total_count)

    @staticmethod
    def get_image_by_id(image_id: str) -> UserGeneratedImage:
        image = db.session.query(UserGeneratedImage).filter(UserGeneratedImage.id == image_id).first()

        if image is None:
            raise Exception("Image not found")

        # sign file with file_id to get a temporary url
        if image.file_id:
            image.image_url = ToolFileManager.sign_file(image.file_id, DEFAULT_IMAGE_EXTENSION)

        return image
