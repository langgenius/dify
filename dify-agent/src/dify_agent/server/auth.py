import hmac

from fastapi import Depends, Header, HTTPException


def create_bearer_token_dependency(expected_token: str | None):
    """Return a FastAPI dependency that validates Bearer token authentication.

    When ``expected_token`` is ``None``, the returned dependency permits all
    requests without checking the header, supporting graceful migration for
    existing deployments.
    """

    async def require_bearer_token(
        authorization: str | None = Header(default=None, alias="Authorization"),
    ) -> None:
        if expected_token is None:
            return
        if authorization is None:
            raise HTTPException(
                status_code=401,
                detail="missing authorization header",
                headers={"WWW-Authenticate": "Bearer"},
            )
        scheme, _, token = authorization.partition(" ")
        token = token.strip()
        if scheme.lower() != "bearer" or not token:
            raise HTTPException(
                status_code=401,
                detail="invalid authorization scheme",
                headers={"WWW-Authenticate": "Bearer"},
            )
        if not hmac.compare_digest(token.encode(), expected_token.encode()):
            raise HTTPException(
                status_code=401,
                detail="invalid bearer token",
                headers={"WWW-Authenticate": "Bearer"},
            )

    return Depends(require_bearer_token)


__all__ = ["create_bearer_token_dependency"]
