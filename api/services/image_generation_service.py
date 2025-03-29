import json
import logging
import os
import random
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple, Union

# Import the UserGeneratedImage model from our controller module
# This is a bit of a circular import, but it's the simplest solution for now
from controllers.service_api_with_auth.app.image_generate import UserGeneratedImage
from extensions.ext_database import db
from models.enums import CreatedByRole
from models.model import App, Conversation, EndUser, Message, UploadFile
from sqlalchemy.orm import Session

# Configure logging
logger = logging.getLogger(__name__)


class ImageGenerationService:
    @staticmethod
    def generate_motivational_text(conversation_id: str, content_type: str) -> str:
        """
        Generate motivational text based on conversation history.

        Args:
            conversation_id: The ID of the conversation
            content_type: Type of content to generate ('self_message' or 'summary_advice')

        Returns:
            str: Generated text content
        """
        # In a real implementation, this would call a large language model
        # Here we'll just use placeholders based on the content type

        with Session(db.engine) as session:
            # Get the last few messages from the conversation to understand context
            messages = (
                session.query(Message)
                .filter(Message.conversation_id == conversation_id)
                .order_by(Message.created_at.desc())
                .limit(20)
                .all()
            )

            # Reverse to get chronological order
            messages.reverse()

            # Extract conversation context
            context = "\n".join([f"User: {msg.query}\nAI: {msg.answer}" for msg in messages])

            # In production, you would pass this context to a language model
            # For demonstration, we'll return placeholder text

            if content_type == "self_message":
                sample_messages = [
                    "You've got this! Take one small step today.",
                    "Remember your strength - you've overcome challenges before.",
                    "Be kind to yourself today, you deserve it.",
                    "Your feelings are valid, and you have the power to work through them.",
                    "Small progress is still progress. Celebrate your wins today.",
                ]
                return random.choice(sample_messages)
            else:  # summary_advice
                sample_advice = [
                    "Based on our conversation, I notice you tend to be hard on yourself. Try practicing self-compassion by speaking to yourself as you would to a friend.",
                    "I've observed that you often describe feeling overwhelmed. Breaking tasks into smaller steps might help manage these feelings better.",
                    "In our discussions, I noticed patterns of negative self-talk. Consider challenging these thoughts by asking 'Is this really true?' when they arise.",
                    "From our conversations, it seems you might benefit from more self-care routines. Even 5 minutes of mindfulness daily could make a difference.",
                    "You've mentioned feeling anxious in social situations. Progressive exposure to small social interactions might help build confidence over time.",
                ]
                return random.choice(sample_advice)

    @staticmethod
    def generate_background_image() -> str:
        """
        Generate or select a background image.

        In a real implementation, this might call an image generation API
        or select from pre-generated images.

        Returns:
            str: URL of the generated/selected image
        """
        # In a real implementation, this would integrate with an image generation API
        # or select from a pool of pre-generated images

        # For this example, we'll return a placeholder
        placeholder_images = [
            "https://example.com/background1.jpg",
            "https://example.com/background2.jpg",
            "https://example.com/background3.jpg",
            "https://example.com/background4.jpg",
            "https://example.com/background5.jpg",
        ]

        return random.choice(placeholder_images)

    @staticmethod
    def overlay_text_on_image(image_url: str, text: str) -> str:
        """
        Overlay text on the image.

        In a real implementation, this would use image processing libraries.

        Args:
            image_url: URL of the background image
            text: Text to overlay on the image

        Returns:
            str: URL of the final image with text
        """
        # In a real implementation, this would use image processing libraries
        # like Pillow to overlay text on the image

        # For this example, we'll just return the same URL
        # In production, you would process the image and save it to storage
        return image_url

    @staticmethod
    def process_image_generation_request(
        app_id: str, conversation_id: str, end_user_id: str, content_type: str
    ) -> Optional[str]:
        """
        Process an image generation request.

        Args:
            app_id: The ID of the app
            conversation_id: The ID of the conversation
            end_user_id: The ID of the end user
            content_type: Type of content to generate ('self_message' or 'summary_advice')

        Returns:
            Optional[str]: ID of the generated image if successful, None otherwise
        """
        try:
            # 1. Generate motivational text based on conversation history
            text_content = ImageGenerationService.generate_motivational_text(
                conversation_id=conversation_id, content_type=content_type
            )

            # 2. Generate or select a background image
            image_url = ImageGenerationService.generate_background_image()

            # 3. Overlay text on the image
            final_image_url = ImageGenerationService.overlay_text_on_image(image_url=image_url, text=text_content)

            # 4. Create and save the user generated image record
            with Session(db.engine) as session:
                new_image = UserGeneratedImage(
                    app_id=app_id,
                    end_user_id=end_user_id,
                    conversation_id=conversation_id,
                    image_url=final_image_url,
                    content_type=content_type,
                    text_content=text_content,
                )

                session.add(new_image)
                session.commit()

                image_id = str(new_image.id)
                logger.info(f"Generated image {image_id} for user {end_user_id}")

                return image_id

        except Exception as e:
            logger.error(f"Error generating image: {str(e)}")
            return None
