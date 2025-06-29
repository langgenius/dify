import logging
from typing import Optional
from uuid import UUID

from flask_login import current_user
from werkzeug.exceptions import NotFound

from models import db
from models.prompt_template import PromptTemplate, PromptVersion


class PromptTemplateService:

    @staticmethod
    def get_prompt_templates():
        """
        Get all prompt templates for the current tenant.
        """
        if not current_user.is_authenticated:
            raise NotFound("User not authenticated.")
        return db.session.query(PromptTemplate).filter_by(tenant_id=current_user.current_tenant_id).all()

    @staticmethod
    def create_prompt_template(
        name: str,
        mode: str,
        prompt_content: str,
        description: Optional[str] = None,
        tags: Optional[list] = None,
        model_name: Optional[str] = None,
        model_parameters: Optional[dict] = None,
    ):
        """
        Create a new prompt template and its initial version.
        """
        logging.info(f"Attempting to create prompt template '{name}' for tenant {current_user.current_tenant_id}")
        try:
            if not current_user.is_authenticated:
                logging.error("User not authenticated during prompt template creation.")
                raise NotFound("User not authenticated.")

            template = PromptTemplate(
                name=name,
                mode=mode,
                description=description,
                tags=tags,
                tenant_id=current_user.current_tenant_id,
            )

            initial_version = PromptVersion(
                prompt_template=template,
                prompt_text=prompt_content,
                model_name=model_name,
                model_parameters=model_parameters,
                created_by=UUID(current_user.id),
            )

            db.session.add(template)
            db.session.add(initial_version)
            db.session.commit()
            logging.info(f"Successfully created prompt template with id {template.id}")

            return template
        except Exception as e:
            logging.error(f"Error creating prompt template '{name}': {e}", exc_info=True)
            db.session.rollback()
            raise

    @staticmethod
    def get_prompt_template(template_id: str):
        """
        Get a specific prompt template by ID for the current tenant.
        """
        if not current_user.is_authenticated:
            raise NotFound("User not authenticated.")

        template = (
            db.session.query(PromptTemplate)
            .filter_by(id=template_id, tenant_id=current_user.current_tenant_id)
            .first()
        )
        if not template:
            raise NotFound(f"Prompt template with id {template_id} not found.")
        return template

    @staticmethod
    def get_prompt_template_for_workflow(template_id: str, tenant_id: str):
        """
        Get a specific prompt template by ID for a specific tenant.
        This method is designed for workflow context where current_user is not available.
        """
        template = (
            db.session.query(PromptTemplate)
            .filter_by(id=template_id, tenant_id=tenant_id)
            .first()
        )
        if not template:
            raise NotFound(f"Prompt template with id {template_id} not found for the given tenant.")
        return template

    @staticmethod
    def update_prompt_template(
        template_id: str,
        name: str,
        mode: str,
        prompt_content: str,
        description: Optional[str] = None,
        tags: Optional[list] = None,
        model_name: Optional[str] = None,
        model_parameters: Optional[dict] = None,
    ):
        """
        Update a prompt template and create a new version if content changes.
        """
        if not current_user.is_authenticated:
            raise NotFound("User not authenticated.")

        template = PromptTemplateService.get_prompt_template(template_id)
        if not template:
            raise NotFound(f"Prompt template with id {template_id} not found.")

        # Update the main template fields
        template.name = name
        template.mode = mode
        template.description = description
        template.tags = tags
        
        latest_version = template.get_latest_version()

        # Create a new version only if the prompt content or model settings have changed
        if (latest_version.prompt_text != prompt_content or
            latest_version.model_name != model_name or
            latest_version.model_parameters != model_parameters):
            new_version = PromptVersion(
                prompt_template=template,
                prompt_text=prompt_content,
                model_name=model_name,
                model_parameters=model_parameters,
                created_by=UUID(current_user.id),
            )
            db.session.add(new_version)

        db.session.commit()
        return template

    @staticmethod
    def delete_prompt_template(template_id: str):
        """
        Delete a specific prompt template by ID for the current tenant.
        """
        if not current_user.is_authenticated:
            raise NotFound("User not authenticated.")

        template = (
            db.session.query(PromptTemplate)
            .filter_by(id=template_id, tenant_id=current_user.current_tenant_id)
            .first()
        )
        if not template:
            raise NotFound(f"Prompt template with id {template_id} not found.")

        db.session.delete(template)
        db.session.commit() 