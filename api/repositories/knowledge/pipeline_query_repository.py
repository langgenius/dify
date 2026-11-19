"""SQLAlchemy query helpers for RAG pipeline-owned projections."""

from sqlalchemy import Select, select
from sqlalchemy.orm import Session, scoped_session

from models.account import Account
from models.dataset import Dataset, Pipeline, PipelineCustomizedTemplate


def get_pipeline_template_creator_name(template: PipelineCustomizedTemplate, session: Session) -> str:
    account = session.scalar(select(Account).where(Account.id == template.created_by))
    if account:
        return account.name
    return ""


def get_pipeline_dataset(pipeline: Pipeline, session: Session | scoped_session) -> Dataset | None:
    return session.scalar(pipeline_dataset_query(pipeline.tenant_id, pipeline.id))


def pipeline_dataset_query(workspace_id: str, pipeline_id: str) -> Select[tuple[Dataset]]:
    return select(Dataset).where(Dataset.pipeline_id == pipeline_id, Dataset.tenant_id == workspace_id)
