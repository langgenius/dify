from sqlalchemy import select
from sqlalchemy.orm import Session

from core.extension.api_based_extension_requestor import APIBasedExtensionRequestor
from core.helper.encrypter import decrypt_token, encrypt_token
from models.api_based_extension import APIBasedExtension, APIBasedExtensionPoint


class APIBasedExtensionService:
    @staticmethod
    def get_all_by_tenant_id(tenant_id: str, *, session: Session) -> list[APIBasedExtension]:
        extension_list = list(
            session.scalars(
                select(APIBasedExtension)
                .where(APIBasedExtension.tenant_id == tenant_id)
                .order_by(APIBasedExtension.created_at.desc())
            ).all()
        )

        for extension in extension_list:
            extension.api_key = decrypt_token(extension.tenant_id, extension.api_key)

        return extension_list

    @classmethod
    def save(cls, extension_data: APIBasedExtension, *, session: Session) -> APIBasedExtension:
        cls._validation(session, extension_data)

        extension_data.api_key = encrypt_token(extension_data.tenant_id, extension_data.api_key)

        session.add(extension_data)
        session.commit()
        return extension_data

    @staticmethod
    def delete(extension_data: APIBasedExtension, *, session: Session):
        session.delete(extension_data)
        session.commit()

    @staticmethod
    def get_with_tenant_id(tenant_id: str, api_based_extension_id: str, *, session: Session) -> APIBasedExtension:
        extension = session.scalar(
            select(APIBasedExtension)
            .where(APIBasedExtension.tenant_id == tenant_id, APIBasedExtension.id == api_based_extension_id)
            .limit(1)
        )

        if not extension:
            raise ValueError("API based extension is not found")

        extension.api_key = decrypt_token(extension.tenant_id, extension.api_key)

        return extension

    @classmethod
    def _validation(cls, session: Session, extension_data: APIBasedExtension):
        # name
        if not extension_data.name:
            raise ValueError("name must not be empty")

        if not extension_data.id:
            # case one: check new data, name must be unique
            is_name_existed = session.scalar(
                select(APIBasedExtension)
                .where(
                    APIBasedExtension.tenant_id == extension_data.tenant_id,
                    APIBasedExtension.name == extension_data.name,
                )
                .limit(1)
            )

            if is_name_existed:
                raise ValueError("name must be unique, it is already existed")
        else:
            # case two: check existing data, name must be unique
            is_name_existed = session.scalar(
                select(APIBasedExtension)
                .where(
                    APIBasedExtension.tenant_id == extension_data.tenant_id,
                    APIBasedExtension.name == extension_data.name,
                    APIBasedExtension.id != extension_data.id,
                )
                .limit(1)
            )

            if is_name_existed:
                raise ValueError("name must be unique, it is already existed")

        # api_endpoint
        if not extension_data.api_endpoint:
            raise ValueError("api_endpoint must not be empty")

        # api_key
        if not extension_data.api_key:
            raise ValueError("api_key must not be empty")

        if len(extension_data.api_key) < 5:
            raise ValueError("api_key must be at least 5 characters")

        # check endpoint
        cls._ping_connection(extension_data)

    @staticmethod
    def _ping_connection(extension_data: APIBasedExtension):
        try:
            client = APIBasedExtensionRequestor(extension_data.api_endpoint, extension_data.api_key)
            resp = client.request(point=APIBasedExtensionPoint.PING, params={})
            if resp.get("result") != "pong":
                raise ValueError(resp)
        except Exception as e:
            raise ValueError(f"connection error: {e}")
