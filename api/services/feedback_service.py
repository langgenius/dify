import csv
import io
import json
from datetime import datetime

from flask import Response, current_app, stream_with_context
from sqlalchemy import or_

from extensions.ext_database import db
from models.model import Account, App, Conversation, Message, MessageFeedback


class FeedbackService:
    BATCH_SIZE = 500

    @staticmethod
    def export_feedbacks(
        app_id: str,
        from_source: str | None = None,
        rating: str | None = None,
        has_comment: bool | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        format_type: str = "csv",
        conversation_id: str | None = None,
    ):
        """
        Export feedback data with message details for analysis

        Args:
            app_id: Application ID
            from_source: Filter by feedback source ('user' or 'admin')
            rating: Filter by rating ('like' or 'dislike')
            has_comment: Only include feedback with comments
            start_date: Start date filter (YYYY-MM-DD)
            end_date: End date filter (YYYY-MM-DD)
            format_type: Export format ('csv' or 'json')
            conversation_id: Filter by conversation ID(s), comma-separated for multiple
        """

        # Validate format early to avoid hitting DB when unnecessary
        fmt = (format_type or "csv").lower()
        if fmt not in {"csv", "json"}:
            raise ValueError(f"Unsupported format: {format_type}")

        # Build base query
        query = (
            db.session.query(MessageFeedback, Message, Conversation, App, Account)
            .join(Message, MessageFeedback.message_id == Message.id)
            .join(Conversation, MessageFeedback.conversation_id == Conversation.id)
            .join(App, MessageFeedback.app_id == App.id)
            .outerjoin(Account, MessageFeedback.from_account_id == Account.id)
            .where(MessageFeedback.app_id == app_id)
        )

        # Apply filters
        if conversation_id:
            # Support multiple conversation IDs (comma-separated)
            conversation_ids = [cid.strip() for cid in conversation_id.split(",") if cid.strip()]
            if len(conversation_ids) == 1:
                query = query.filter(MessageFeedback.conversation_id == conversation_ids[0])
            else:
                query = query.filter(MessageFeedback.conversation_id.in_(conversation_ids))

        if from_source:
            query = query.filter(MessageFeedback.from_source == from_source)

        if rating:
            query = query.filter(MessageFeedback.rating == rating)

        if has_comment is not None:
            if has_comment:
                query = query.filter(MessageFeedback.content.isnot(None), MessageFeedback.content != "")
            else:
                query = query.filter(or_(MessageFeedback.content.is_(None), MessageFeedback.content == ""))

        if start_date:
            try:
                start_dt = datetime.strptime(start_date, "%Y-%m-%d")
                query = query.filter(MessageFeedback.created_at >= start_dt)
            except ValueError:
                raise ValueError(f"Invalid start_date format: {start_date}. Use YYYY-MM-DD")

        if end_date:
            try:
                end_dt = datetime.strptime(end_date, "%Y-%m-%d")
                query = query.filter(MessageFeedback.created_at <= end_dt)
            except ValueError:
                raise ValueError(f"Invalid end_date format: {end_date}. Use YYYY-MM-DD")

        # Order by creation date (newest first)
        query = query.order_by(MessageFeedback.created_at.desc(), MessageFeedback.id.desc())

        # Export based on format
        if fmt == "csv":
            return FeedbackService._export_csv_stream(query, app_id)
        else:  # fmt == "json" -> JSONL streaming
            return FeedbackService._export_jsonl_stream(query, app_id)

    @staticmethod
    def _format_feedback_row(feedback, message, conversation, app, account) -> dict:
        """Format a single feedback record"""
        user_query = message.query or (message.inputs.get("query", "") if message.inputs else "")

        return {
            "feedback_id": str(feedback.id),
            "app_name": app.name,
            "app_id": str(app.id),
            "conversation_id": str(conversation.id),
            "conversation_name": conversation.name or "",
            "message_id": str(message.id),
            "user_query": user_query,
            "ai_response": message.answer[:500] + "..." if len(message.answer) > 500 else message.answer,
            "feedback_rating": "👍" if feedback.rating == "like" else "👎",
            "feedback_rating_raw": feedback.rating,
            "feedback_comment": feedback.content or "",
            "feedback_source": feedback.from_source,
            "feedback_date": feedback.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            "message_date": message.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            "from_account_name": account.name if account else "",
            "from_end_user_id": str(feedback.from_end_user_id) if feedback.from_end_user_id else "",
            "has_comment": "Yes" if feedback.content and feedback.content.strip() else "No",
        }

    @staticmethod
    def _generate_csv_rows(query, flask_app):
        """Generator to fetch and format data in batches for CSV streaming"""
        headers = [
            "feedback_id",
            "app_name",
            "app_id",
            "conversation_id",
            "conversation_name",
            "message_id",
            "user_query",
            "ai_response",
            "feedback_rating",
            "feedback_rating_raw",
            "feedback_comment",
            "feedback_source",
            "feedback_date",
            "message_date",
            "from_account_name",
            "from_end_user_id",
            "has_comment",
        ]
        # Yield header row
        output = io.StringIO()
        writer = csv.writer(output, lineterminator="\r\n")
        writer.writerow(headers)
        yield output.getvalue()

        with flask_app.app_context():
            last_created_at = None
            last_id = None
            while True:
                batch_query = query.limit(FeedbackService.BATCH_SIZE)
                if last_created_at is not None and last_id is not None:
                    # Use keyset pagination for efficient querying
                    batch_query = batch_query.where(
                        db.or_(
                            MessageFeedback.created_at < last_created_at,
                            db.and_(
                                MessageFeedback.created_at == last_created_at,
                                MessageFeedback.id < last_id,
                            ),
                        )
                    )
                batch = batch_query.all()
                if not batch:
                    break

                for feedback, message, conversation, app_obj, account in batch:
                    row = FeedbackService._format_feedback_row(feedback, message, conversation, app_obj, account)
                    # Use csv module for proper escaping
                    output = io.StringIO()
                    writer = csv.writer(output, lineterminator="\r\n")
                    writer.writerow([str(row.get(field, "")) for field in headers])
                    yield output.getvalue()

                if len(batch) < FeedbackService.BATCH_SIZE:
                    break

                # Track last item for next batch (keyset pagination)
                last_item = batch[-1]
                last_created_at = last_item[0].created_at
                last_id = last_item[0].id

    @staticmethod
    def _export_csv_stream(query, app_id):
        """Export data as streaming CSV"""
        flask_app = current_app._get_current_object()  # type: ignore
        generator = FeedbackService._generate_csv_rows(query, flask_app)
        response = Response(
            stream_with_context(generator),
            mimetype="text/csv; charset=utf-8-sig",
        )
        response.headers["Content-Disposition"] = (
            f"attachment; filename=dify_feedback_export_{app_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        )
        return response

    @staticmethod
    def _generate_jsonl_rows(query, flask_app):
        """Generator to fetch and format data in batches for JSONL streaming"""
        with flask_app.app_context():
            last_created_at = None
            last_id = None
            while True:
                batch_query = query.limit(FeedbackService.BATCH_SIZE)
                if last_created_at is not None and last_id is not None:
                    # Use keyset pagination for efficient querying
                    batch_query = batch_query.where(
                        db.or_(
                            MessageFeedback.created_at < last_created_at,
                            db.and_(
                                MessageFeedback.created_at == last_created_at,
                                MessageFeedback.id < last_id,
                            ),
                        )
                    )
                batch = batch_query.all()
                if not batch:
                    break

                for feedback, message, conversation, app_obj, account in batch:
                    row = FeedbackService._format_feedback_row(feedback, message, conversation, app_obj, account)
                    yield json.dumps(row, ensure_ascii=False) + "\n"

                if len(batch) < FeedbackService.BATCH_SIZE:
                    break

                # Track last item for next batch (keyset pagination)
                last_item = batch[-1]
                last_created_at = last_item[0].created_at
                last_id = last_item[0].id

    @staticmethod
    def _export_jsonl_stream(query, app_id):
        """Export data as streaming JSONL"""
        flask_app = current_app._get_current_object()  # type: ignore
        generator = FeedbackService._generate_jsonl_rows(query, flask_app)
        response = Response(
            stream_with_context(generator),
            mimetype="application/jsonl; charset=utf-8",
        )
        response.headers["Content-Disposition"] = (
            f"attachment; filename=dify_feedback_export_{app_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jsonl"
        )
        return response
