from __future__ import annotations

from sqlalchemy.orm import sessionmaker

from extensions.ext_database import db
from repositories.sqlalchemy_execution_extra_content_repository import SQLAlchemyExecutionExtraContentRepository
from tests.test_containers_integration_tests.helpers.execution_extra_content import (
    create_human_input_message_fixture,
)


def test_get_by_message_ids_returns_human_input_content(db_session_with_containers):
    fixture = create_human_input_message_fixture(db_session_with_containers)
    repository = SQLAlchemyExecutionExtraContentRepository(
        session_maker=sessionmaker(bind=db.engine, expire_on_commit=False)
    )

    results = repository.get_by_message_ids([fixture.message.id])

    assert len(results) == 1
    assert len(results[0]) == 1
    content = results[0][0]
    assert content.submitted is True
    assert content.form_submission_data is not None
    assert content.form_submission_data.action_id == fixture.action_id
    assert content.form_submission_data.action_text == fixture.action_text
    assert content.form_submission_data.rendered_content == fixture.form.rendered_content
