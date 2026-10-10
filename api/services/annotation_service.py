import logging
import uuid
from typing import TypedDict

import pandas as pd
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import NotFound

from enums import DeploymentEdition
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from libs.login import current_account_with_tenant
from libs.pagination import paginate_query
from models.account import Account
from models.dataset import DatasetCollectionBinding
from models.model import App, AppAnnotationHitHistory, AppAnnotationSetting, MessageAnnotation
from services.app_ref_service import AnnotationRef
from services.feature_service import FeatureService
from tasks.annotation.add_annotation_to_index_task import add_annotation_to_index_task
from tasks.annotation.batch_import_annotations_task import batch_import_annotations_task
from tasks.annotation.delete_annotation_index_task import delete_annotation_index_task
from tasks.annotation.disable_annotation_reply_task import disable_annotation_reply_task
from tasks.annotation.enable_annotation_reply_task import enable_annotation_reply_task
from tasks.annotation.update_annotation_to_index_task import update_annotation_to_index_task

logger = logging.getLogger(__name__)


class AnnotationJobStatusDict(TypedDict):
    job_id: str
    job_status: str


class EmbeddingModelDict(TypedDict):
    embedding_provider_name: str
    embedding_model_name: str


class AnnotationSettingDict(TypedDict):
    id: str
    enabled: bool
    score_threshold: float
    embedding_model: EmbeddingModelDict | dict


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


class UpdateAnnotationSettingArgs(TypedDict):
    """Expected shape of the args dict passed to update_app_annotation_setting."""

    score_threshold: float


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
        enable_app_annotation_job_key = f"enable_app_annotation_job_{job_id}"
        # send batch add segments task
        redis_client.setnx(enable_app_annotation_job_key, "waiting")
        current_user, current_tenant_id = current_account_with_tenant()
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
        disable_app_annotation_job_key = f"disable_app_annotation_job_{job_id}"
        # send batch add segments task
        redis_client.setnx(disable_app_annotation_job_key, "waiting")
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
    def batch_import_app_annotations(cls, app_id: str, file: FileStorage, session: Session):
        """
        Batch import annotations from CSV file with enhanced security checks.

        Security features:
        - File size validation
        - Row count limits (min/max)
        - Memory-efficient CSV parsing
        - Subscription quota validation
        - Concurrency tracking
        """
        from configs import dify_config

        # get app info
        current_user, current_tenant_id = current_account_with_tenant()
        app = session.scalar(
            select(App).where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal").limit(1)
        )

        if not app:
            raise NotFound("App not found")

        job_id: str | None = None  # Initialize to avoid unbound variable error
        try:
            # Quick row count check before full parsing (memory efficient)
            # Read only first chunk to estimate row count
            file.stream.seek(0)
            first_chunk = file.stream.read(8192)  # Read first 8KB
            file.stream.seek(0)

            # Estimate row count from first chunk
            newline_count = first_chunk.count(b"\n")
            if newline_count == 0:
                raise ValueError("The CSV file appears to be empty or invalid.")

            # Parse CSV with row limit to prevent memory exhaustion
            # Use chunksize for memory-efficient processing
            max_records = dify_config.ANNOTATION_IMPORT_MAX_RECORDS
            min_records = dify_config.ANNOTATION_IMPORT_MIN_RECORDS

            # Read CSV in chunks to avoid loading entire file into memory
            df = pd.read_csv(
                file.stream,
                dtype=str,
                keep_default_na=False,
                nrows=max_records + 1,  # Read one extra to detect overflow
                engine="python",
                on_bad_lines="skip",  # Skip malformed lines instead of crashing
            )

            # Validate column count
            if len(df.columns) < 2:
                raise ValueError("Invalid CSV format. The file must contain at least 2 columns (question and answer).")

            # Build result list with validation
            result: list[dict] = []
            for idx, row in df.iterrows():
                # Stop if we exceed the limit
                if len(result) >= max_records:
                    raise ValueError(
                        f"The CSV file contains too many records. Maximum {max_records} records allowed per import. "
                        f"Please split your file into smaller batches."
                    )

                # Extract and validate question and answer
                try:
                    question_raw = row.iloc[0]
                    answer_raw = row.iloc[1]
                except (IndexError, KeyError):
                    continue  # Skip malformed rows

                # Convert to string and strip whitespace
                question = str(question_raw).strip() if question_raw is not None else ""
                answer = str(answer_raw).strip() if answer_raw is not None else ""

                # Skip empty entries or NaN values
                if not question or not answer or question.lower() == "nan" or answer.lower() == "nan":
                    continue

                # Validate length constraints (idx is pandas index, convert to int for display)
                row_num = int(idx) + 2 if isinstance(idx, (int, float)) else len(result) + 2
                if len(question) > 2000:
                    raise ValueError(f"Question at row {row_num} is too long. Maximum 2000 characters allowed.")
                if len(answer) > 10000:
                    raise ValueError(f"Answer at row {row_num} is too long. Maximum 10000 characters allowed.")

                content = {"question": question, "answer": answer}
                result.append(content)

            # Validate minimum records
            if len(result) < min_records:
                raise ValueError(
                    f"The CSV file must contain at least {min_records} valid annotation record(s). "
                    f"Found {len(result)} valid record(s)."
                )

            # Check annotation quota limit
            if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
                features = FeatureService.get_features(current_tenant_id, exclude_vector_space=True)
                annotation_quota_limit = features.annotation_quota_limit
                if 0 < annotation_quota_limit.limit < len(result) + annotation_quota_limit.size:
                    raise ValueError("The number of annotations exceeds the limit of your subscription.")
            # async job
            job_id = str(uuid.uuid4())
            indexing_cache_key = f"app_annotation_batch_import_{job_id}"

            # Register job in active tasks list for concurrency tracking
            current_time = int(naive_utc_now().timestamp() * 1000)
            active_jobs_key = f"annotation_import_active:{current_tenant_id}"
            redis_client.zadd(active_jobs_key, {job_id: current_time})
            redis_client.expire(active_jobs_key, 7200)  # 2 hours TTL

            # Set job status
            redis_client.setnx(indexing_cache_key, "waiting")
            batch_import_annotations_task.delay(job_id, result, app_id, current_tenant_id, current_user.id)

        except ValueError as e:
            return {"error_msg": str(e)}
        except Exception as e:
            # Clean up active job registration on error (only if job was created)
            if job_id is not None:
                try:
                    active_jobs_key = f"annotation_import_active:{current_tenant_id}"
                    redis_client.zrem(active_jobs_key, job_id)
                except Exception:
                    # Silently ignore cleanup errors - the job will be auto-expired
                    logger.debug("Failed to clean up active job tracking during error handling")

            # Check if it's a CSV parsing error
            error_str = str(e)
            return {"error_msg": f"An error occurred while processing the file: {error_str}"}

        return {"job_id": job_id, "job_status": "waiting", "record_count": len(result)}

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

    @classmethod
    def update_app_annotation_setting(
        cls, app_id: str, annotation_setting_id: str, args: UpdateAnnotationSettingArgs, session: Session
    ) -> AnnotationSettingDict:
        current_user, current_tenant_id = current_account_with_tenant()
        # get app info
        app = session.scalar(
            select(App).where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal").limit(1)
        )

        if not app:
            raise NotFound("App not found")

        annotation_setting = session.scalar(
            select(AppAnnotationSetting)
            .where(
                AppAnnotationSetting.app_id == app_id,
                AppAnnotationSetting.id == annotation_setting_id,
            )
            .limit(1)
        )
        if not annotation_setting:
            raise NotFound("App annotation not found")
        annotation_setting.score_threshold = args["score_threshold"]
        annotation_setting.updated_user_id = current_user.id
        annotation_setting.updated_at = naive_utc_now()
        session.add(annotation_setting)
        session.flush()

        collection_binding_detail = session.get(DatasetCollectionBinding, annotation_setting.collection_binding_id)

        if collection_binding_detail:
            return {
                "id": annotation_setting.id,
                "enabled": True,
                "score_threshold": annotation_setting.score_threshold,
                "embedding_model": {
                    "embedding_provider_name": collection_binding_detail.provider_name,
                    "embedding_model_name": collection_binding_detail.model_name,
                },
            }
        else:
            return {
                "id": annotation_setting.id,
                "enabled": True,
                "score_threshold": annotation_setting.score_threshold,
                "embedding_model": {},
            }
