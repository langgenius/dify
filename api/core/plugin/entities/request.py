from pydantic import BaseModel


class RequestInvokeTool(BaseModel):
    """
    Request to invoke a tool
    """

class RequestInvokeLLM(BaseModel):
    """
    Request to invoke LLM
    """

class RequestInvokeTextEmbedding(BaseModel):
    """
    Request to invoke text embedding
    """

class RequestInvokeRerank(BaseModel):
    """
    Request to invoke rerank
    """

class RequestInvokeTTS(BaseModel):
    """
    Request to invoke TTS
    """

class RequestInvokeSpeech2Text(BaseModel):
    """
    Request to invoke speech2text
    """

class RequestInvokeModeration(BaseModel):
    """
    Request to invoke moderation
    """

class RequestInvokeNode(BaseModel):
    """
    Request to invoke node
    """