# -*- coding:utf-8 -*-
from datetime import datetime

from flask_login import login_required, current_user
from flask_restful import Resource, reqparse, fields, marshal
from werkzeug.exceptions import NotFound, Forbidden

import services
from controllers.console import api
from controllers.console.datasets.error import InvalidActionError
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import DocumentSegment

from libs.helper import TimestampField
from services.dataset_service import DatasetService, DocumentService
from tasks.add_segment_to_index_task import add_segment_to_index_task
from tasks.remove_segment_from_index_task import remove_segment_from_index_task

segment_fields = {
    'id': fields.String,
    'position': fields.Integer,
    'document_id': fields.String,
    'content': fields.String,
    'word_count': fields.Integer,
    'tokens': fields.Integer,
    'keywords': fields.List(fields.String),
    'index_node_id': fields.String,
    'index_node_hash': fields.String,
    'hit_count': fields.Integer,
    'enabled': fields.Boolean,
    'disabled_at': TimestampField,
    'disabled_by': fields.String,
    'status': fields.String,
    'created_by': fields.String,
    'created_at': TimestampField,
    'indexing_at': TimestampField,
    'completed_at': TimestampField,
    'error': fields.String,
    'stopped_at': TimestampField
}

segment_list_response = {
    'data': fields.List(fields.Nested(segment_fields)),
    'has_more': fields.Boolean,
    'limit': fields.Integer
}


class DatasetDocumentSegmentListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, dataset_id, document_id):
        dataset_id = str(dataset_id)
        document_id = str(document_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound('Dataset not found.')

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        document = DocumentService.get_document(dataset_id, document_id)

        if not document:
            raise NotFound('Document not found.')

        parser = reqparse.RequestParser()
        parser.add_argument('last_id', type=str, default=None, location='args')
        parser.add_argument('limit', type=int, default=20, location='args')
        parser.add_argument('status', type=str,
                            action='append', default=[], location='args')
        parser.add_argument('hit_count_gte', type=int,
                            default=None, location='args')
        parser.add_argument('enabled', type=str, default='all', location='args')
        parser.add_argument('keyword', type=str, default=None, location='args')
        args = parser.parse_args()

        last_id = args['last_id']
        limit = min(args['limit'], 100)
        status_list = args['status']
        hit_count_gte = args['hit_count_gte']
        keyword = args['keyword']

        query = DocumentSegment.query.filter(
            DocumentSegment.document_id == str(document_id),
            DocumentSegment.tenant_id == current_user.current_tenant_id
        )

        if last_id is not None:
            last_segment = DocumentSegment.query.get(str(last_id))
            if last_segment:
                query = query.filter(
                    DocumentSegment.position > last_segment.position)
            else:
                return {'data': [], 'has_more': False, 'limit': limit}, 200

        if status_list:
            query = query.filter(DocumentSegment.status.in_(status_list))

        if hit_count_gte is not None:
            query = query.filter(DocumentSegment.hit_count >= hit_count_gte)

        if keyword:
            query = query.where(DocumentSegment.content.ilike(f'%{keyword}%'))

        if args['enabled'].lower() != 'all':
            if args['enabled'].lower() == 'true':
                query = query.filter(DocumentSegment.enabled == True)
            elif args['enabled'].lower() == 'false':
                query = query.filter(DocumentSegment.enabled == False)

        total = query.count()
        segments = query.order_by(DocumentSegment.position).limit(limit + 1).all()

        has_more = False
        if len(segments) > limit:
            has_more = True
            segments = segments[:-1]

        return {
            'data': marshal(segments, segment_fields),
            'has_more': has_more,
            'limit': limit,
            'total': total
        }, 200


class DatasetDocumentSegmentApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, dataset_id, segment_id, action):
        dataset_id = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if not dataset:
            raise NotFound('Dataset not found.')

        # The role of the current user in the ta table must be admin or owner
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
            raise Forbidden()

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        segment = DocumentSegment.query.filter(
            DocumentSegment.id == str(segment_id),
            DocumentSegment.tenant_id == current_user.current_tenant_id
        ).first()

        if not segment:
            raise NotFound('Segment not found.')

        document_indexing_cache_key = 'document_{}_indexing'.format(segment.document_id)
        cache_result = redis_client.get(document_indexing_cache_key)
        if cache_result is not None:
            raise InvalidActionError("Document is being indexed, please try again later")

        indexing_cache_key = 'segment_{}_indexing'.format(segment.id)
        cache_result = redis_client.get(indexing_cache_key)
        if cache_result is not None:
            raise InvalidActionError("Segment is being indexed, please try again later")

        if action == "enable":
            if segment.enabled:
                raise InvalidActionError("Segment is already enabled.")

            segment.enabled = True
            segment.disabled_at = None
            segment.disabled_by = None
            db.session.commit()

            # Set cache to prevent indexing the same segment multiple times
            redis_client.setex(indexing_cache_key, 600, 1)

            add_segment_to_index_task.delay(segment.id)

            return {'result': 'success'}, 200
        elif action == "disable":
            if not segment.enabled:
                raise InvalidActionError("Segment is already disabled.")

            segment.enabled = False
            segment.disabled_at = datetime.utcnow()
            segment.disabled_by = current_user.id
            db.session.commit()

            # Set cache to prevent indexing the same segment multiple times
            redis_client.setex(indexing_cache_key, 600, 1)

            remove_segment_from_index_task.delay(segment.id)

            return {'result': 'success'}, 200
        else:
            raise InvalidActionError()


api.add_resource(DatasetDocumentSegmentListApi,
                 '/datasets/<uuid:dataset_id>/documents/<uuid:document_id>/segments')
api.add_resource(DatasetDocumentSegmentApi,
                 '/datasets/<uuid:dataset_id>/segments/<uuid:segment_id>/<string:action>')
