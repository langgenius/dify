from dify_app import DifyApp
from repositories.knowledge.upload_file_repository import register_upload_file_reference_guards


def init_app(_app: DifyApp) -> None:
    register_upload_file_reference_guards()
