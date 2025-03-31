import json
import logging
import time

import click
from celery import shared_task  # type: ignore
from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from models.model import App, EndUser, Message, UserGeneratedImage
from services.app_generate_service import AppGenerateService


@shared_task(queue="generation")
def generate_image_task(
    end_user_id: str,
    content_type: str,
    image_id: str,
) -> str:
    """
    Asynchronously generate an image based on the end user's conversation data and update the existing UserGeneratedImage record

    Args:
        end_user_id: End user ID
        content_type: Type of content to generate (self_message or summary_advice)
        app_id: The app ID of the end user
        image_id: ID of the existing pending UserGeneratedImage entity to update

    Returns:
        The ID of the updated image record

    Usage: generate_image_task.delay(end_user_id, content_type, app_id, image_id)
    """
    logging.info(click.style(f"Starting image generation for user {end_user_id}, image_id: {image_id}", fg="green"))
    start_at = time.perf_counter()

    try:
        # Retrieve models for processing
        end_user = db.session.query(EndUser).filter(EndUser.id == end_user_id).first()
        if not end_user:
            raise Exception(f"End user {end_user_id} not found")

        # Get the existing UserGeneratedImage entity
        user_generated_image = db.session.query(UserGeneratedImage).filter(UserGeneratedImage.id == image_id).first()
        if not user_generated_image:
            raise Exception(f"UserGeneratedImage {image_id} not found")

        # Update status to processing
        user_generated_image.status = "processing"
        db.session.commit()

        # Get image generation app
        if dify_config.IMAGE_GENERATION_APP_ID is None:
            user_generated_image.status = "failed"
            user_generated_image.error_message = "Image generation app id is not set"
            db.session.commit()
            raise Exception("Image generation app id is not set")

        image_generation_app_model = App.query.filter(App.id == dify_config.IMAGE_GENERATION_APP_ID).first()
        if image_generation_app_model is None:
            user_generated_image.status = "failed"
            user_generated_image.error_message = "Image generation app model is not found"
            db.session.commit()
            raise Exception("Image generation app model is not found")

        # Get user profile and recent messages
        user_profile = end_user.extra_profile
        recent_messages = (
            db.session.query(Message)
            .filter(Message.app_id == end_user.app_id, Message.from_end_user_id == end_user.id)
            .order_by(Message.created_at.desc())
            .limit(10)
            .all()
        )

        recent_messages = [f"user: {message.query}\n\nassistant: {message.answer}" for message in recent_messages]

        # Prepare arguments for generation
        args = {
            "inputs": {
                "user_profile": json.dumps(user_profile),
                "recent_messages": "\n\n".join(recent_messages),
                "image_type": content_type,
            }
        }

        # Generate image through app service
        response = AppGenerateService.generate(
            app_model=image_generation_app_model,
            user=end_user,
            args=args,
            invoke_from=InvokeFrom.SCHEDULER,
            streaming=False,
        )

        if not isinstance(response, dict):
            user_generated_image.status = "failed"
            user_generated_image.error_message = "Failed to generate image"
            db.session.commit()
            raise Exception("Failed to generate image")

        # Extract workflow run ID and content
        workflow_run_id = response.get("workflow_run_id")
        raw_content = response.get("data", {}).get("outputs", {})

        # Parse URL from response
        image_objs = raw_content.get("files")
        url = None
        for image_obj in image_objs:
            if image_obj.get("type") == "image":
                url = image_obj.get("url")
                break

        if url is None:
            user_generated_image.status = "failed"
            user_generated_image.error_message = "No image URL found in response"
            db.session.commit()
            raise Exception("Failed to generate image")

        text_content = raw_content.get("text")

        # Update the existing UserGeneratedImage with the generated content
        user_generated_image.workflow_run_id = workflow_run_id
        user_generated_image.image_url = url
        user_generated_image.text_content = text_content
        user_generated_image.raw_content = raw_content
        user_generated_image.status = "completed"
        db.session.commit()

        end_at = time.perf_counter()
        logging.info(
            click.style(
                f"Image generation completed for user {end_user_id}. Image ID: {image_id}. Latency: {end_at - start_at}",
                fg="green",
            )
        )

        return image_id
    except Exception as e:
        logging.exception(f"Failed to generate image: {str(e)}")
        # Update status to failed if we have the entity
        try:
            user_generated_image = (
                db.session.query(UserGeneratedImage).filter(UserGeneratedImage.id == image_id).first()
            )
            if user_generated_image:
                user_generated_image.status = "failed"
                user_generated_image.error_message = str(e)
                db.session.commit()
        except Exception:
            logging.exception(f"Failed to update image status for {image_id}")
        raise
