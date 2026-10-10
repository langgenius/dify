"""Knowledge bases a workflow's knowledge-retrieval node can search."""

from __future__ import annotations

from collections.abc import Mapping
from http import HTTPStatus
from typing import Any

from flask_restx import Resource

from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint
from controllers.openapi._models import (
    KnowledgeBaseListQuery,
    KnowledgeBaseListResponse,
    KnowledgeBaseRow,
    KnowledgeRetrievalFragment,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import workspace_read
from extensions.ext_application_services import application_services
from services.knowledge.datasets.application import DatasetListFilter


def knowledge_base_row(record: Mapping[str, Any]) -> KnowledgeBaseRow:
    return KnowledgeBaseRow(
        id=record["id"],
        name=record["name"],
        description=record.get("description"),
        provider=record["provider"],
        indexing_technique=record.get("indexing_technique"),
        document_count=record["document_count"],
        usable=record.get("embedding_available") is not False,
        node_data=KnowledgeRetrievalFragment(dataset_ids=[record["id"]]),
    )


@openapi_ns.route("/workspaces/<string:workspace_id>/knowledge-bases")
class KnowledgeBasesApi(Resource):
    @endpoint(
        op="get.knowledge_base",
        kind=Kind.LIST,
        summary="Knowledge bases you can use, each with the knowledge-retrieval node data to paste",
        examples=(Example(title="Find product docs", input={"query": "product"}),),
        requirements=workspace_read(),
        query=KnowledgeBaseListQuery,
        returns=(HTTPStatus.OK, KnowledgeBaseListResponse, "Knowledge bases"),
    )
    def get(self, ctx: Context, workspace_id: str, *, query: KnowledgeBaseListQuery):
        page = application_services().knowledge.datasets.list_datasets(
            ctx.request_context, DatasetListFilter(page=query.page, limit=query.limit, keyword=query.query or None)
        )
        return KnowledgeBaseListResponse.build(
            page=query.page, limit=query.limit, total=page["total"], items=[knowledge_base_row(r) for r in page["data"]]
        )
