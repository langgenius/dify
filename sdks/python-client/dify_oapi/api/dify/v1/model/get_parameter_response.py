from dify_oapi.core.model.base_response import BaseResponse


class GetParameterResponse(BaseResponse):
    opening_statement: str | None = None
    suggested_questions: list[str] | None = None
    suggested_questions_after_answer: dict | None = None
    speech_to_text: dict | None = None
    retriever_resource: dict | None = None
    annotation_reply: dict | None = None
    user_input_form: list[dict] | None = None
    file_upload: dict | None = None
    system_parameters: dict | None = None
