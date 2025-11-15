import uuid

import pandas as pd
from sqlalchemy import or_, select
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import NotFound

from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from libs.login import current_account_with_tenant
from models.model import App, AppAnnotationHitHistory, AppAnnotationSetting, Message, MessageAnnotation
from services.feature_service import FeatureService
from tasks.annotation.add_annotation_to_index_task import add_annotation_to_index_task
from tasks.annotation.batch_import_annotations_task import batch_import_annotations_task
from tasks.annotation.delete_annotation_index_task import delete_annotation_index_task
from tasks.annotation.disable_annotation_reply_task import disable_annotation_reply_task
from tasks.annotation.enable_annotation_reply_task import enable_annotation_reply_task
from tasks.annotation.update_annotation_to_index_task import update_annotation_to_index_task


class AppAnnotationService:
    @classmethod
    def up_insert_app_annotation_from_message(cls, args: dict, app_id: str) -> MessageAnnotation:
        # get app info
        current_user, current_tenant_id = current_account_with_tenant()
        app = (
            db.session.query(App)
            .where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal")
            .first()
        )

        if not app:
            raise NotFound("App not found")

        answer = args.get("answer") or args.get("content")
        if answer is None:
            raise ValueError("Either 'answer' or 'content' must be provided")

        if args.get("message_id"):
            message_id = str(args["message_id"])
            message = db.session.query(Message).where(Message.id == message_id, Message.app_id == app.id).first()

            if not message:
                raise NotFound("Message Not Exists.")

            question = args.get("question") or message.query or ""

            annotation: MessageAnnotation | None = message.annotation
            if annotation:
                annotation.content = answer
                annotation.question = question
            else:
                annotation = MessageAnnotation(
                    app_id=app.id,
                    conversation_id=message.conversation_id,
                    message_id=message.id,
                    content=answer,
                    question=question,
                    account_id=current_user.id,
                )
        else:
            question = args.get("question")
            if not question:
                raise ValueError("'question' is required when 'message_id' is not provided")

            annotation = MessageAnnotation(app_id=app.id, content=answer, question=question, account_id=current_user.id)
        db.session.add(annotation)
        db.session.commit()

        annotation_setting = db.session.query(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_id).first()
        assert current_tenant_id is not None
        if annotation_setting:
            add_annotation_to_index_task.delay(
                annotation.id,
                annotation.question,
                current_tenant_id,
                app_id,
                annotation_setting.collection_binding_id,
            )
        return annotation

    @classmethod
    def enable_app_annotation(cls, args: dict, app_id: str):
        enable_app_annotation_key = f"enable_app_annotation_{str(app_id)}"
        cache_result = redis_client.get(enable_app_annotation_key)
        if cache_result is not None:
            return {"job_id": cache_result, "job_status": "processing"}

        # async job
        job_id = str(uuid.uuid4())
        enable_app_annotation_job_key = f"enable_app_annotation_job_{str(job_id)}"
        # send batch add segments task
        redis_client.setnx(enable_app_annotation_job_key, "waiting")
        current_user, current_tenant_id = current_account_with_tenant()
        enable_annotation_reply_task.delay(
            str(job_id),
            app_id,
            current_user.id,
            current_tenant_id,
            args["score_threshold"],
            args["embedding_provider_name"],
            args["embedding_model_name"],
        )
        return {"job_id": job_id, "job_status": "waiting"}

    @classmethod
    def disable_app_annotation(cls, app_id: str):
        _, current_tenant_id = current_account_with_tenant()
        disable_app_annotation_key = f"disable_app_annotation_{str(app_id)}"
        cache_result = redis_client.get(disable_app_annotation_key)
        if cache_result is not None:
            return {"job_id": cache_result, "job_status": "processing"}

        # async job
        job_id = str(uuid.uuid4())
        disable_app_annotation_job_key = f"disable_app_annotation_job_{str(job_id)}"
        # send batch add segments task
        redis_client.setnx(disable_app_annotation_job_key, "waiting")
        disable_annotation_reply_task.delay(str(job_id), app_id, current_tenant_id)
        return {"job_id": job_id, "job_status": "waiting"}

    @classmethod
    def get_annotation_list_by_app_id(cls, app_id: str, page: int, limit: int, keyword: str):
        # get app info
        _, current_tenant_id = current_account_with_tenant()
        app = (
            db.session.query(App)
            .where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal")
            .first()
        )

        if not app:
            raise NotFound("App not found")
        if keyword:
            stmt = (
                select(MessageAnnotation)
                .where(MessageAnnotation.app_id == app_id)
                .where(
                    or_(
                        MessageAnnotation.question.ilike(f"%{keyword}%"),
                        MessageAnnotation.content.ilike(f"%{keyword}%"),
                    )
                )
                .order_by(MessageAnnotation.created_at.desc(), MessageAnnotation.id.desc())
            )
        else:
            stmt = (
                select(MessageAnnotation)
                .where(MessageAnnotation.app_id == app_id)
                .order_by(MessageAnnotation.created_at.desc(), MessageAnnotation.id.desc())
            )
        annotations = db.paginate(select=stmt, page=page, per_page=limit, max_per_page=100, error_out=False)
        return annotations.items, annotations.total

    @classmethod
    def export_annotation_list_by_app_id(cls, app_id: str):
        # get app info
        _, current_tenant_id = current_account_with_tenant()
        app = (
            db.session.query(App)
            .where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal")
            .first()
        )

        if not app:
            raise NotFound("App not found")
        annotations = (
            db.session.query(MessageAnnotation)
            .where(MessageAnnotation.app_id == app_id)
            .order_by(MessageAnnotation.created_at.desc())
            .all()
        )
        return annotations

    @classmethod
    def insert_app_annotation_directly(cls, args: dict, app_id: str) -> MessageAnnotation:
        # get app info
        current_user, current_tenant_id = current_account_with_tenant()
        app = (
            db.session.query(App)
            .where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal")
            .first()
        )

        if not app:
            raise NotFound("App not found")

        annotation = MessageAnnotation(
            app_id=app.id, content=args["answer"], question=args["question"], account_id=current_user.id
        )
        db.session.add(annotation)
        db.session.commit()
        # if annotation reply is enabled , add annotation to index
        annotation_setting = db.session.query(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_id).first()
        if annotation_setting:
            add_annotation_to_index_task.delay(
                annotation.id,
                args["question"],
                current_tenant_id,
                app_id,
                annotation_setting.collection_binding_id,
            )
        return annotation

    @classmethod
    def update_app_annotation_directly(cls, args: dict, app_id: str, annotation_id: str):
        # get app info
        _, current_tenant_id = current_account_with_tenant()
        app = (
            db.session.query(App)
            .where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal")
            .first()
        )

        if not app:
            raise NotFound("App not found")

        annotation = db.session.query(MessageAnnotation).where(MessageAnnotation.id == annotation_id).first()

        if not annotation:
            raise NotFound("Annotation not found")

        annotation.content = args["answer"]
        annotation.question = args["question"]

        db.session.commit()
        # if annotation reply is enabled , add annotation to index
        app_annotation_setting = (
            db.session.query(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_id).first()
        )

        if app_annotation_setting:
            update_annotation_to_index_task.delay(
                annotation.id,
                annotation.question,
                current_tenant_id,
                app_id,
                app_annotation_setting.collection_binding_id,
            )

        return annotation

    @classmethod
    def delete_app_annotation(cls, app_id: str, annotation_id: str):
        # get app info
        _, current_tenant_id = current_account_with_tenant()
        app = (
            db.session.query(App)
            .where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal")
            .first()
        )

        if not app:
            raise NotFound("App not found")

        annotation = db.session.query(MessageAnnotation).where(MessageAnnotation.id == annotation_id).first()

        if not annotation:
            raise NotFound("Annotation not found")

        db.session.delete(annotation)

        annotation_hit_histories = db.session.scalars(
            select(AppAnnotationHitHistory).where(AppAnnotationHitHistory.annotation_id == annotation_id)
        ).all()
        if annotation_hit_histories:
            for annotation_hit_history in annotation_hit_histories:
                db.session.delete(annotation_hit_history)

        db.session.commit()
        # if annotation reply is enabled , delete annotation index
        app_annotation_setting = (
            db.session.query(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_id).first()
        )

        if app_annotation_setting:
            delete_annotation_index_task.delay(
                annotation.id, app_id, current_tenant_id, app_annotation_setting.collection_binding_id
            )

    @classmethod
    def delete_app_annotations_in_batch(cls, app_id: str, annotation_ids: list[str]):
        # get app info
        _, current_tenant_id = current_account_with_tenant()
        app = (
            db.session.query(App)
            .where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal")
            .first()
        )

        if not app:
            raise NotFound("App not found")

        # Fetch annotations and their settings in a single query
        annotations_to_delete = (
            db.session.query(MessageAnnotation, AppAnnotationSetting)
            .outerjoin(AppAnnotationSetting, MessageAnnotation.app_id == AppAnnotationSetting.app_id)
            .where(MessageAnnotation.id.in_(annotation_ids))
            .all()
        )

        if not annotations_to_delete:
            return {"deleted_count": 0}

        # Step 1: Extract IDs for bulk operations
        annotation_ids_to_delete = [annotation.id for annotation, _ in annotations_to_delete]

        # Step 2: Bulk delete hit histories in a single query
        db.session.query(AppAnnotationHitHistory).where(
            AppAnnotationHitHistory.annotation_id.in_(annotation_ids_to_delete)
        ).delete(synchronize_session=False)

        # Step 3: Trigger async tasks for search index deletion
        for annotation, annotation_setting in annotations_to_delete:
            if annotation_setting:
                delete_annotation_index_task.delay(
                    annotation.id, app_id, current_tenant_id, annotation_setting.collection_binding_id
                )

        # Step 4: Bulk delete annotations in a single query
        deleted_count = (
            db.session.query(MessageAnnotation)
            .where(MessageAnnotation.id.in_(annotation_ids_to_delete))
            .delete(synchronize_session=False)
        )

        db.session.commit()
        return {"deleted_count": deleted_count}

    @classmethod
    def batch_import_app_annotations(cls, app_id, file: FileStorage):
        # get app info
        current_user, current_tenant_id = current_account_with_tenant()
        app = (
            db.session.query(App)
            .where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal")
            .first()
        )

        if not app:
            raise NotFound("App not found")

        try:
            # Skip the first row
            df = pd.read_csv(file.stream, dtype=str)
            result = []
            for _, row in df.iterrows():
                content = {"question": row.iloc[0], "answer": row.iloc[1]}
                result.append(content)
            if len(result) == 0:
                raise ValueError("The CSV file is empty.")
            # check annotation limit
            features = FeatureService.get_features(current_tenant_id)
            if features.billing.enabled:
                annotation_quota_limit = features.annotation_quota_limit
                if annotation_quota_limit.limit < len(result) + annotation_quota_limit.size:
                    raise ValueError("The number of annotations exceeds the limit of your subscription.")
            # async job
            job_id = str(uuid.uuid4())
            indexing_cache_key = f"app_annotation_batch_import_{str(job_id)}"
            # send batch add segments task
            redis_client.setnx(indexing_cache_key, "waiting")
            batch_import_annotations_task.delay(str(job_id), result, app_id, current_tenant_id, current_user.id)
        except Exception as e:
            return {"error_msg": str(e)}
        return {"job_id": job_id, "job_status": "waiting"}

    @classmethod
    def get_annotation_hit_histories(cls, app_id: str, annotation_id: str, page, limit):
        _, current_tenant_id = current_account_with_tenant()
        # get app info
        app = (
            db.session.query(App)
            .where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal")
            .first()
        )

        if not app:
            raise NotFound("App not found")

        annotation = db.session.query(MessageAnnotation).where(MessageAnnotation.id == annotation_id).first()

        if not annotation:
            raise NotFound("Annotation not found")

        stmt = (
            select(AppAnnotationHitHistory)
            .where(
                AppAnnotationHitHistory.app_id == app_id,
                AppAnnotationHitHistory.annotation_id == annotation_id,
            )
            .order_by(AppAnnotationHitHistory.created_at.desc())
        )
        annotation_hit_histories = db.paginate(
            select=stmt, page=page, per_page=limit, max_per_page=100, error_out=False
        )
        return annotation_hit_histories.items, annotation_hit_histories.total

    @classmethod
    def get_annotation_by_id(cls, annotation_id: str) -> MessageAnnotation | None:
        annotation = db.session.query(MessageAnnotation).where(MessageAnnotation.id == annotation_id).first()

        if not annotation:
            return None
        return annotation

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
    ):
        # add hit count to annotation
        db.session.query(MessageAnnotation).where(MessageAnnotation.id == annotation_id).update(
            {MessageAnnotation.hit_count: MessageAnnotation.hit_count + 1}, synchronize_session=False
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
        db.session.add(annotation_hit_history)
        db.session.commit()

    @classmethod
    def get_app_annotation_setting_by_app_id(cls, app_id: str):
        _, current_tenant_id = current_account_with_tenant()
        # get app info
        app = (
            db.session.query(App)
            .where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal")
            .first()
        )

        if not app:
            raise NotFound("App not found")

        annotation_setting = db.session.query(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_id).first()
        if annotation_setting:
            collection_binding_detail = annotation_setting.collection_binding_detail
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
        return {"enabled": False}

    @classmethod
    def update_app_annotation_setting(cls, app_id: str, annotation_setting_id: str, args: dict):
        current_user, current_tenant_id = current_account_with_tenant()
        # get app info
        app = (
            db.session.query(App)
            .where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal")
            .first()
        )

        if not app:
            raise NotFound("App not found")

        annotation_setting = (
            db.session.query(AppAnnotationSetting)
            .where(
                AppAnnotationSetting.app_id == app_id,
                AppAnnotationSetting.id == annotation_setting_id,
            )
            .first()
        )
        if not annotation_setting:
            raise NotFound("App annotation not found")
        annotation_setting.score_threshold = args["score_threshold"]
        annotation_setting.updated_user_id = current_user.id
        annotation_setting.updated_at = naive_utc_now()
        db.session.add(annotation_setting)
        db.session.commit()

        collection_binding_detail = annotation_setting.collection_binding_detail

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

    @classmethod
    def clear_all_annotations(cls, app_id: str):
        _, current_tenant_id = current_account_with_tenant()
        app = (
            db.session.query(App)
            .where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal")
            .first()
        )

        if not app:
            raise NotFound("App not found")

        # if annotation reply is enabled, delete annotation index
        app_annotation_setting = (
            db.session.query(AppAnnotationSetting).where(AppAnnotationSetting.app_id == app_id).first()
        )

        annotations_query = db.session.query(MessageAnnotation).where(MessageAnnotation.app_id == app_id)
        for annotation in annotations_query.yield_per(100):
            annotation_hit_histories_query = db.session.query(AppAnnotationHitHistory).where(
                AppAnnotationHitHistory.annotation_id == annotation.id
            )
            for annotation_hit_history in annotation_hit_histories_query.yield_per(100):
                db.session.delete(annotation_hit_history)

            # if annotation reply is enabled, delete annotation index
            if app_annotation_setting:
                delete_annotation_index_task.delay(
                    annotation.id, app_id, current_tenant_id, app_annotation_setting.collection_binding_id
                )

            db.session.delete(annotation)

        db.session.commit()
        return {"result": "success"}
