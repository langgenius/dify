"""make message annotation question not nullable

Revision ID: 9e6fa5cbcd80
Revises: 03f8dcbc611e
Create Date: 2025-11-06 16:03:54.549378

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '9e6fa5cbcd80'
down_revision = '288345cd01d1'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    message_annotations = sa.table(
        "message_annotations",
        sa.column("id", sa.String),
        sa.column("message_id", sa.String),
        sa.column("question", sa.Text),
    )
    messages = sa.table(
        "messages",
        sa.column("id", sa.String),
        sa.column("query", sa.Text),
    )
    update_question_from_message = (
        sa.update(message_annotations)
        .where(
            sa.and_(
                message_annotations.c.question.is_(None),
                message_annotations.c.message_id.isnot(None),
            )
        )
        .values(
            question=sa.select(sa.func.coalesce(messages.c.query, ""))
            .where(messages.c.id == message_annotations.c.message_id)
            .scalar_subquery()
        )
    )
    bind.execute(update_question_from_message)

    fill_remaining_questions = (
        sa.update(message_annotations)
        .where(message_annotations.c.question.is_(None))
        .values(question="")
    )
    bind.execute(fill_remaining_questions)
    with op.batch_alter_table('message_annotations', schema=None) as batch_op:
        batch_op.alter_column('question', existing_type=sa.TEXT(), nullable=False)


def downgrade():
    with op.batch_alter_table('message_annotations', schema=None) as batch_op:
        batch_op.alter_column('question', existing_type=sa.TEXT(), nullable=True)
