from dify_oapi.core.http.transport import ATransport, Transport
from dify_oapi.core.model.config import Config
from dify_oapi.core.model.request_option import RequestOption

from ..model.create_document_by_text_request import CreateDocumentByTextRequest
from ..model.create_document_by_file_request import CreateDocumentByFileRequest
from ..model.create_document_response import CreateDocumentResponse
from ..model.update_document_by_text_request import UpdateDocumentByTextRequest
from ..model.update_document_by_file_request import UpdateDocumentByFileRequest
from ..model.update_document_response import UpdateDocumentResponse
from ..model.delete_document_request import DeleteDocumentRequest
from ..model.delete_document_response import DeleteDocumentResponse
from ..model.list_document_request import ListDocumentRequest
from ..model.list_document_response import ListDocumentResponse
from ..model.index_status_request import IndexStatusRequest
from ..model.index_status_response import IndexStatusResponse


class Document:
    def __init__(self, config: Config) -> None:
        self.config: Config = config

    def create_by_text(
        self, request: CreateDocumentByTextRequest, option: RequestOption | None = None
    ) -> CreateDocumentResponse:
        return Transport.execute(
            self.config, request, unmarshal_as=CreateDocumentResponse, option=option
        )

    async def acreate_by_text(
        self, request: CreateDocumentByTextRequest, option: RequestOption | None = None
    ) -> CreateDocumentResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=CreateDocumentResponse, option=option
        )

    def update_by_text(
        self, request: UpdateDocumentByTextRequest, option: RequestOption | None = None
    ) -> UpdateDocumentResponse:
        return Transport.execute(
            self.config, request, unmarshal_as=UpdateDocumentResponse, option=option
        )

    async def aupdate_by_text(
        self, request: UpdateDocumentByTextRequest, option: RequestOption | None = None
    ) -> UpdateDocumentResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=UpdateDocumentResponse, option=option
        )

    def create_by_file(
        self, request: CreateDocumentByFileRequest, option: RequestOption | None = None
    ) -> CreateDocumentResponse:
        return Transport.execute(
            self.config, request, unmarshal_as=CreateDocumentResponse, option=option
        )

    async def acreate_by_file(
        self, request: CreateDocumentByFileRequest, option: RequestOption | None = None
    ) -> CreateDocumentResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=CreateDocumentResponse, option=option
        )

    def update_by_file(
        self, request: UpdateDocumentByFileRequest, option: RequestOption | None = None
    ) -> UpdateDocumentResponse:
        return Transport.execute(
            self.config, request, unmarshal_as=UpdateDocumentResponse, option=option
        )

    async def aupdate_by_file(
        self, request: UpdateDocumentByFileRequest, option: RequestOption | None = None
    ) -> UpdateDocumentResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=UpdateDocumentResponse, option=option
        )

    def list(
        self, request: ListDocumentRequest, option: RequestOption | None = None
    ) -> ListDocumentResponse:
        return Transport.execute(
            self.config, request, unmarshal_as=ListDocumentResponse, option=option
        )

    async def alist(
        self, request: ListDocumentRequest, option: RequestOption | None = None
    ) -> ListDocumentResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=ListDocumentResponse, option=option
        )

    def delete(
        self, request: DeleteDocumentRequest, option: RequestOption | None = None
    ) -> DeleteDocumentResponse:
        return Transport.execute(
            self.config, request, unmarshal_as=DeleteDocumentResponse, option=option
        )

    async def adelete(
        self, request: DeleteDocumentRequest, option: RequestOption | None = None
    ) -> DeleteDocumentResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=DeleteDocumentResponse, option=option
        )

    def indexing_status(
        self, request: IndexStatusRequest, option: RequestOption | None = None
    ) -> IndexStatusResponse:
        return Transport.execute(
            self.config, request, unmarshal_as=IndexStatusResponse, option=option
        )

    async def aindexing_status(
        self, request: IndexStatusRequest, option: RequestOption | None = None
    ) -> IndexStatusResponse:
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=IndexStatusResponse, option=option
        )
