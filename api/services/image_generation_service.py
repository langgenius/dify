import json
from enum import Enum

from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from libs.helper import RateLimiter
from libs.infinite_scroll_pagination import MultiPagePagination
from models.model import App, EndUser, Message, UserGeneratedImage
from services.app_generate_service import AppGenerateService


# define string enum for content_type
class ContentType(str, Enum):
    SELF_MESSAGE = "self_message"
    SUMMARY_ADVICE = "summary_advice"


class ImageGenerationService:

    generate_image_rate_limiter = RateLimiter(
        prefix="generate_image_rate_limit", max_attempts=dify_config.IMAGE_GENERATION_DAILY_LIMIT, time_window=86400 * 1
    )

    @staticmethod
    def generate_image(end_user: EndUser, content_type: ContentType) -> str:

        if ImageGenerationService.generate_image_rate_limiter.is_rate_limited(end_user.id):
            raise Exception("Image generation rate limit exceeded")

        if dify_config.IMAGE_GENERATION_APP_ID is None:
            raise Exception("Image generation app id is not set")

        image_generation_app_model = App.query.filter(App.id == dify_config.IMAGE_GENERATION_APP_ID).first()
        if image_generation_app_model is None:
            raise Exception("Image generation app model is not found")

        user_profile = end_user.extra_profile
        recent_messages = (
            db.session.query(Message)
            .filter(Message.app_id == end_user.app_id, Message.from_end_user_id == end_user.id)
            .order_by(Message.created_at.desc())
            .limit(10)
            .all()
        )

        recent_messages = [f"user: {message.query}\n\nassistant: {message.answer}" for message in recent_messages]

        args = {
            "inputs": {
                "user_profile": json.dumps(user_profile),
                "recent_messages": "\n\n".join(recent_messages),
                "image_type": content_type,
            }
        }

        try:
            response = AppGenerateService.generate(
                app_model=image_generation_app_model,
                user=end_user,
                args=args,
                invoke_from=InvokeFrom.SCHEDULER,
                streaming=False,
            )

            if not isinstance(response, dict):
                raise Exception("Failed to generate image")

            # load workflow id and save it to db for futher fetch image status
            workflow_run_id = response.get("workflow_run_id")

            raw_content = response.get("data", {}).get("outputs", {})

            # parse url from response.data.outputs
            image_objs = raw_content.get("files")
            url = None
            for image_obj in image_objs:
                if image_obj.get("type") == "image":
                    url = image_obj.get("url")
                    break

            if url is None:
                raise Exception("Failed to generate image")

            text_content = raw_content.get("text")

            user_generated_image = UserGeneratedImage(
                app_id=end_user.app_id,
                end_user_id=end_user.id,
                workflow_run_id=workflow_run_id,
                content_type=content_type,
                image_url=url,
                text_content=text_content,
                raw_content=raw_content,
            )

            db.session.add(user_generated_image)
            db.session.commit()

            return user_generated_image.id

        except Exception as e:
            raise Exception(f"Failed to generate image: {e}")

    @staticmethod
    def pagination_image_list(end_user: EndUser, limit: int, offset: int) -> MultiPagePagination:

        query = (
            db.session.query(UserGeneratedImage)
            .filter(UserGeneratedImage.app_id == end_user.app_id, UserGeneratedImage.end_user_id == end_user.id)
            .order_by(UserGeneratedImage.created_at.desc())
        )

        total_count = query.count()
        images = query.limit(limit).offset(offset).all()

        return MultiPagePagination(data=images, total=total_count)

    @staticmethod
    def get_image_by_id(image_id: str) -> UserGeneratedImage:
        image = db.session.query(UserGeneratedImage).filter(UserGeneratedImage.id == image_id).first()

        if image is None:
            raise Exception("Image not found")

        return image
