"""
Integration tests for AppModelConfig using testcontainers.

These tests validate database-backed model behavior without mocking SQLAlchemy queries.
"""

from uuid import uuid4

from sqlalchemy.orm import Session

from models.model import AppModelConfig


class TestAppModelConfig:
    """Integration tests for AppModelConfig."""

    def test_annotation_reply_dict_disabled_without_setting(self, container_session: Session) -> None:
        """Return disabled annotation reply dict when no AppAnnotationSetting exists."""
        # Arrange
        config = AppModelConfig(app_id=str(uuid4()))
        container_session.add(config)
        container_session.commit()

        # Act
        result = config.annotation_reply_dict

        # Assert
        assert result == {"enabled": False}

        # Cleanup
        container_session.delete(config)
        container_session.commit()
