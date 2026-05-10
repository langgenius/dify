"""``/v1/models`` router — list models permitted for the authenticated customer."""

from __future__ import annotations

from fastapi import APIRouter, Request

from gateway.registry import CustomerEntry
from gateway.schemas import ModelInfo, ModelList

router = APIRouter()


@router.get("/v1/models")
async def list_models(request: Request) -> ModelList:
    customer: CustomerEntry = request.state.customer
    return ModelList(
        data=[
            ModelInfo(id=m.id, owned_by=customer.customer_id)
            for m in customer.models
        ]
    )
