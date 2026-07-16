from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.create_knowledge_space import CreateKnowledgeSpace
from ...models.create_knowledge_space_response_400_type_0 import (
    CreateKnowledgeSpaceResponse400Type0,
)
from ...models.error_response import ErrorResponse
from ...models.knowledge_space_creation_response import KnowledgeSpaceCreationResponse
from ...types import Response


def _get_kwargs(
    *,
    body: CreateKnowledgeSpace,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/knowledge-spaces",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    CreateKnowledgeSpaceResponse400Type0
    | ErrorResponse
    | ErrorResponse
    | KnowledgeSpaceCreationResponse
    | None
):
    if response.status_code == 201:
        response_201 = KnowledgeSpaceCreationResponse.from_dict(response.json())

        return response_201

    if response.status_code == 400:

        def _parse_response_400(
            data: object,
        ) -> CreateKnowledgeSpaceResponse400Type0 | ErrorResponse:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                response_400_type_0 = CreateKnowledgeSpaceResponse400Type0.from_dict(
                    data
                )

                return response_400_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            response_400_type_1 = ErrorResponse.from_dict(data)

            return response_400_type_1

        response_400 = _parse_response_400(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = ErrorResponse.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = ErrorResponse.from_dict(response.json())

        return response_403

    if response.status_code == 409:
        response_409 = ErrorResponse.from_dict(response.json())

        return response_409

    if response.status_code == 422:
        response_422 = ErrorResponse.from_dict(response.json())

        return response_422

    if response.status_code == 429:
        response_429 = ErrorResponse.from_dict(response.json())

        return response_429

    if response.status_code == 503:
        response_503 = ErrorResponse.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    CreateKnowledgeSpaceResponse400Type0
    | ErrorResponse
    | ErrorResponse
    | KnowledgeSpaceCreationResponse
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: CreateKnowledgeSpace,
) -> Response[
    CreateKnowledgeSpaceResponse400Type0
    | ErrorResponse
    | ErrorResponse
    | KnowledgeSpaceCreationResponse
]:
    """
    Args:
        body (CreateKnowledgeSpace):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CreateKnowledgeSpaceResponse400Type0 | ErrorResponse | ErrorResponse | KnowledgeSpaceCreationResponse]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    body: CreateKnowledgeSpace,
) -> (
    CreateKnowledgeSpaceResponse400Type0
    | ErrorResponse
    | ErrorResponse
    | KnowledgeSpaceCreationResponse
    | None
):
    """
    Args:
        body (CreateKnowledgeSpace):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CreateKnowledgeSpaceResponse400Type0 | ErrorResponse | ErrorResponse | KnowledgeSpaceCreationResponse
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: CreateKnowledgeSpace,
) -> Response[
    CreateKnowledgeSpaceResponse400Type0
    | ErrorResponse
    | ErrorResponse
    | KnowledgeSpaceCreationResponse
]:
    """
    Args:
        body (CreateKnowledgeSpace):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[CreateKnowledgeSpaceResponse400Type0 | ErrorResponse | ErrorResponse | KnowledgeSpaceCreationResponse]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: CreateKnowledgeSpace,
) -> (
    CreateKnowledgeSpaceResponse400Type0
    | ErrorResponse
    | ErrorResponse
    | KnowledgeSpaceCreationResponse
    | None
):
    """
    Args:
        body (CreateKnowledgeSpace):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        CreateKnowledgeSpaceResponse400Type0 | ErrorResponse | ErrorResponse | KnowledgeSpaceCreationResponse
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
