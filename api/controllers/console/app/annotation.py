from flask_restful import Resource, reqparse, marshal_with
from controllers.console import api
from controllers.console.app.error import NoFileUploadedError
from controllers.console.datasets.error import TooManyFilesError
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from extensions.ext_redis import redis_client
from fields.annotation_fields import annotation_list_fields, annotation_hit_history_list_fields
from fields.conversation_fields import annotation_fields
from libs.login import login_required
from services.annotation_service import AppAnnotationService
from flask import request


class AnnotationReplyActionApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_id, action):
        app_id = str(app_id)
        parser = reqparse.RequestParser()
        parser.add_argument('embedding_provider_name', required=True, type=str, location='json')
        parser.add_argument('embedding_model_name', required=True, type=str, location='json')
        args = parser.parse_args()
        if action == 'enable':
            result = AppAnnotationService.enable_app_annotation(args, app_id)
        elif action == 'disable':
            result = AppAnnotationService.disable_app_annotation(args, app_id)
        else:
            raise ValueError('Unsupported annotation reply action')
        return result, 200


class AnnotationReplyActionStatusApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_id, job_id, action):
        job_id = str(job_id)
        app_annotation_job_key = '{}_app_annotation_job_{}'.format(action, str(job_id))
        cache_result = redis_client.get(app_annotation_job_key)
        if cache_result is None:
            raise ValueError("The job is not exist.")

        job_status = cache_result.decode()
        error_msg = ''
        if job_status == 'error':
            app_annotation_error_key = '{}_app_annotation_error_{}'.format(action, str(job_id))
            error_msg = redis_client.get(app_annotation_error_key).decode()

        return {
            'job_id': job_id,
            'job_status': job_status,
            'error_msg': error_msg
        }, 200


class AnnotationListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(annotation_list_fields)
    def get(self, app_id):
        app_id = str(app_id)
        annotation_list = AppAnnotationService.get_annotation_list_by_app_id(app_id)
        return annotation_list


class AnnotationCreateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(annotation_fields)
    def post(self, app_id):
        app_id = str(app_id)
        parser = reqparse.RequestParser()
        parser.add_argument('question', required=True, type=str, location='json')
        parser.add_argument('content', required=True, type=str, location='json')
        args = parser.parse_args()
        annotation = AppAnnotationService.insert_app_annotation_directly(args, app_id)
        return annotation


class AnnotationUpdateDeleteApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(annotation_fields)
    def post(self, app_id, annotation_id):
        app_id = str(app_id)
        annotation_id = str(annotation_id)
        parser = reqparse.RequestParser()
        parser.add_argument('question', required=True, type=str, location='json')
        parser.add_argument('content', required=True, type=str, location='json')
        args = parser.parse_args()
        annotation = AppAnnotationService.update_app_annotation_directly(args, app_id, annotation_id)
        return annotation

    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(annotation_fields)
    def delete(self, app_id, annotation_id):
        app_id = str(app_id)
        annotation_id = str(annotation_id)
        annotation = AppAnnotationService.delete_app_annotation(app_id, annotation_id)
        return annotation


class AnnotationBatchImportApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_id):
        app_id = str(app_id)
        # get file from request
        file = request.files['file']
        # check file
        if 'file' not in request.files:
            raise NoFileUploadedError()

        if len(request.files) > 1:
            raise TooManyFilesError()
        # check file type
        if not file.filename.endswith('.csv'):
            raise ValueError("Invalid file type. Only CSV files are allowed")
        AppAnnotationService.batch_import_app_annotations(app_id, file)

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, job_id):
        job_id = str(job_id)
        indexing_cache_key = 'app_annotation_batch_import_{}'.format(str(job_id))
        cache_result = redis_client.get(indexing_cache_key)
        if cache_result is None:
            raise ValueError("The job is not exist.")
        job_status = cache_result.decode()
        error_msg = ''
        if job_status == 'error':
            indexing_error_msg_key = 'app_annotation_batch_import_error_msg_{}'.format(str(job_id))
            error_msg = redis_client.get(indexing_error_msg_key).decode()

        return {
            'job_id': job_id,
            'job_status': job_status,
            'error_msg': error_msg
        }, 200


class AnnotationHitHistoryListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(annotation_hit_history_list_fields)
    def get(self, app_id, annotation_id):
        app_id = str(app_id)
        annotation_id = str(annotation_id)
        annotation_hit_history_list = AppAnnotationService.get_annotation_hit_histories(app_id, annotation_id)
        return annotation_hit_history_list


api.add_resource(AnnotationReplyActionApi, '/apps/<uuid:app_id>/annotation-reply/<string:action>')
api.add_resource(AnnotationReplyActionStatusApi,
                 '/apps/<uuid:app_id>/annotation-reply/<string:action>/status/<uuid:job_id>')
api.add_resource(AnnotationListApi, '/apps/<uuid:app_id>/annotations')
api.add_resource(AnnotationUpdateDeleteApi, '/apps/<uuid:app_id>/annotations/<uuid:annotation_id>')
api.add_resource(AnnotationBatchImportApi, '/apps/<uuid:app_id>/annotations/batch-import',
                 '/apps/{app_id}/annotations/batch-import-status/<uuid:job_id>')
api.add_resource(AnnotationHitHistoryListApi, '/apps/<uuid:app_id>/annotations/{annotation_id}/hit-histories')

