import uuid
from typing import TypedDict

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from extensions.ext_redis import redis_client
from libs.login import current_account_with_tenant
from libs.pagination import paginate_query
from models.account import Account
from models.model import App, AppAnnotationHitHistory, AppAnnotationSetting, MessageAnnotation
from repositories.annotation_reply_job_repository import RedisAnnotationReplyJobRepository
from services.app_ref_service import AnnotationRef
from tasks.annotation.add_annotation_to_index_task import add_annotation_to_index_task
from tasks.annotation.delete_annotation_index_task import delete_annotation_index_task
from tasks.annotation.disable_annotation_reply_task import disable_annotation_reply_task
from tasks.annotation.enable_annotation_reply_task import enable_annotation_reply_task
from tasks.annotation.update_annotation_to_index_task import update_annotation_to_index_task


class AnnotationJobStatusDict(TypedDict):
    job_id: str
    job_status: str


class EnableAnnotationArgs(TypedDict):
    """Expected shape of the args dict passed to enable_app_annotation."""

    score_threshold: float
    embedding_provider_name: str
    embedding_model_name: str


class InsertAnnotationArgs(TypedDict):
    """Expected shape of the args dict passed to insert_app_annotation_directly."""

    question: str
    answer: str


class UpdateAnnotationArgs(TypedDict, total=False):
    """Expected shape of the args dict passed to update_app_annotation_directly.

    Both fields are optional at the type level; the service validates at runtime
    and raises ValueError if either is missing.
    """

    answer: str
    question: str


class AppAnnotationService:
    @staticmethod
    def _get_annotation_by_ref(annotation_ref: AnnotationRef, session: Session) -> MessageAnnotation | None:
        return session.scalar(
            select(MessageAnnotation)
            .where(
                MessageAnnotation.id == annotation_ref.annotation_id,
                MessageAnnotation.app_id == annotation_ref.app.app_id,
            )
            .limit(1)
        )

    @classmethod
    def enable_app_annotation(cls, args: EnableAnnotationArgs, app_id: str) -> AnnotationJobStatusDict:
        enable_app_annotation_key = f"enable_app_annotation_{app_id}"
        cache_result = redis_client.get(enable_app_annotation_key)
        if cache_result is not None:
            return {"job_id": cache_result, "job_status": "processing"}

        # async job
        job_id = str(uuid.uuid4())
        current_user, current_tenant_id = current_account_with_tenant()
        # TODO: Remove this bridge when the Service API migrates to AnnotationReplyService.
        RedisAnnotationReplyJobRepository(redis=redis_client).create(
            tenant_id=current_tenant_id, app_id=app_id, action="enable", job_id=job_id
        )
        enable_annotation_reply_task.delay(
            job_id,
            app_id,
            current_user.id,
            current_tenant_id,
            args["score_threshold"],
            args["embedding_provider_name"],
            args["embedding_model_name"],
        )
        return {"job_id": job_id, "job_status": "waiting"}

    @classmethod
    def disable_app_annotation(cls, app_id: str) -> AnnotationJobStatusDict:
        _, current_tenant_id = current_account_with_tenant()
        disable_app_annotation_key = f"disable_app_annotation_{app_id}"
        cache_result = redis_client.get(disable_app_annotation_key)
        if cache_result is not None:
            return {"job_id": cache_result, "job_status": "processing"}

        # async job
        job_id = str(uuid.uuid4())
        # TODO: Remove this bridge when the Service API migrates to AnnotationReplyService.
        RedisAnnotationReplyJobRepository(redis=redis_client).create(
            tenant_id=current_tenant_id, app_id=app_id, action="disable", job_id=job_id
        )
        disable_annotation_reply_task.delay(job_id, app_id, current_tenant_id)
        return {"job_id": job_id, "job_status": "waiting"}

    @classmethod
    def get_annotation_list_by_app_id(cls, app_id: str, page: int, limit: int, keyword: str, session: Session):
        # TODO: Migrate the Service API list caller off its shared session before removing this legacy query.
        # get app info
        _, current_tenant_id = current_account_with_tenant()
        app = session.scalar(
            select(App).where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal").limit(1)
        )

        if not app:
            raise NotFound("App not found")
        if keyword:
            from libs.helper import escape_like_pattern

            escaped_keyword = escape_like_pattern(keyword)
            stmt = (
                select(MessageAnnotation)
                .where(
                    MessageAnnotation.app_id == app_id,
                    or_(
                        MessageAnnotation.question.ilike(f"%{escaped_keyword}%", escape="\\"),
                        MessageAnnotation.content.ilike(f"%{escaped_keyword}%", escape="\\"),
                    ),
                )
                .order_by(MessageAnnotation.created_at.desc(), MessageAnnotation.id.desc())
            )
        else:
            stmt = (
                select(MessageAnnotation)
                .where(MessageAnnotation.app_id == app_id)
                .order_by(MessageAnnotation.created_at.desc(), MessageAnnotation.id.desc())
            )
        annotations = paginate_query(stmt, session=session, page=page, per_page=limit, max_per_page=100)
        return annotations.items, annotations.total or 0

    @classmethod
    def insert_app_annotation_directly(
        cls, args: InsertAnnotationArgs, app_id: str, session: Session
    ) -> MessageAnnotation:
        # get app info
        current_user, current_tenant_id = current_account_with_tenant()
        app = session.scalar(
            select(App).where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal").limit(1)
        )

        if not app:
            raise NotFound("App not found")

        question = args.get("question")
        if question is None:
            raise ValueError("'question' is required")

        annotation = MessageAnnotation(
            app_id=app.id, content=args["answer"], question=question, account_id=current_user.id
        )
        session.add(annotation)
        session.commit()
        # if annotation reply is enabled , add annotation to index
        annotation_setting = session.scalar(
            select(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_id).limit(1)
        )
        if annotation_setting:
            add_annotation_to_index_task.delay(
                annotation.id,
                question,
                current_tenant_id,
                app_id,
                annotation_setting.collection_binding_id,
            )
        return annotation

    @classmethod
    def update_app_annotation_directly(
        cls,
        args: UpdateAnnotationArgs,
        annotation_ref: AnnotationRef,
        session: Session,
    ):
        annotation = cls._get_annotation_by_ref(annotation_ref, session)

        if not annotation:
            raise NotFound("Annotation not found")

        question = args.get("question")
        if question is None:
            raise ValueError("'question' is required")

        answer = args.get("answer")
        if answer is None:
            raise ValueError("'answer' is required")

        annotation.content = answer
        annotation.question = question

        session.commit()
        # if annotation reply is enabled , add annotation to index
        app_annotation_setting = session.scalar(
            select(AppAnnotationSetting).where(AppAnnotationSetting.app_id == annotation_ref.app.app_id).limit(1)
        )

        if app_annotation_setting:
            update_annotation_to_index_task.delay(
                annotation.id,
                annotation.question_text,
                annotation_ref.app.tenant_id,
                annotation_ref.app.app_id,
                app_annotation_setting.collection_binding_id,
            )

        return annotation

    @classmethod
    def delete_app_annotation(cls, annotation_ref: AnnotationRef, session: Session):
        annotation = cls._get_annotation_by_ref(annotation_ref, session)

        if not annotation:
            raise NotFound("Annotation not found")

        session.delete(annotation)

        annotation_hit_histories = session.scalars(
            select(AppAnnotationHitHistory).where(
                AppAnnotationHitHistory.app_id == annotation_ref.app.app_id,
                AppAnnotationHitHistory.annotation_id == annotation_ref.annotation_id,
            )
        ).all()
        if annotation_hit_histories:
            for annotation_hit_history in annotation_hit_histories:
                session.delete(annotation_hit_history)

        session.commit()
        # if annotation reply is enabled , delete annotation index
        app_annotation_setting = session.scalar(
            select(AppAnnotationSetting).where(AppAnnotationSetting.app_id == annotation_ref.app.app_id).limit(1)
        )

        if app_annotation_setting:
            delete_annotation_index_task.delay(
                annotation.id,
                annotation_ref.app.app_id,
                annotation_ref.app.tenant_id,
                app_annotation_setting.collection_binding_id,
            )

    @classmethod
    def get_annotation_by_id(cls, annotation_id: str, session: Session) -> MessageAnnotation | None:
        annotation = session.get(MessageAnnotation, annotation_id)

        if not annotation:
            return None
        return annotation

    @classmethod
    def get_annotation_reply_by_id(
        cls, annotation_id: str, session: Session
    ) -> tuple[MessageAnnotation, str | None] | None:
        """Read a reply and its author together, retaining annotations whose account was deleted."""
        row = session.execute(
            select(MessageAnnotation, Account.name)
            .outerjoin(Account, Account.id == MessageAnnotation.account_id)
            .where(MessageAnnotation.id == annotation_id)
        ).one_or_none()
        return (row[0], row[1]) if row is not None else None

    @classmethod
    def add_annotation_history(
        cls,
        annotation_id: str,
        app_id: str,
        annotation_question: str,
        annotation_content: str,
        query: str,
        user_id: str,
        message_id: str,
        from_source: str,
        score: float,
        session: Session,
    ) -> None:
        # add hit count to annotation
        session.execute(
            update(MessageAnnotation)
            .where(MessageAnnotation.id == annotation_id)
            .values(hit_count=MessageAnnotation.hit_count + 1)
        )

        annotation_hit_history = AppAnnotationHitHistory(
            annotation_id=annotation_id,
            app_id=app_id,
            account_id=user_id,
            question=query,
            source=from_source,
            score=score,
            message_id=message_id,
            annotation_question=annotation_question,
            annotation_content=annotation_content,
        )
        session.add(annotation_hit_history)
        session.flush()
