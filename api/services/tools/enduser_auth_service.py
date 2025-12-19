import json
import logging

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from constants import HIDDEN_VALUE, UNKNOWN_VALUE
from core.helper.name_generator import generate_incremental_name
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.entities.api_entities import ToolProviderCredentialApiEntity
from core.tools.tool_manager import ToolManager
from core.tools.utils.encryption import create_provider_encrypter
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.tools import EndUserAuthenticationProvider
from services.tools.tools_transform_service import ToolTransformService

logger = logging.getLogger(__name__)


class EndUserAuthService:
    """
    Service for managing end-user authentication credentials.
    Follows similar patterns to BuiltinToolManageService but for end users.
    """

    __MAX_CREDENTIALS_PER_PROVIDER__ = 100

    @staticmethod
    def list_credentials(
        tenant_id: str, end_user_id: str, provider_id: str
    ) -> list[ToolProviderCredentialApiEntity]:
        """
        List all credentials for a specific provider and end user.

        :param end_user_id: The end user ID
        :param tenant_id: The tenant ID
        :param provider_id: The provider identifier
        :return: List of credential entities
        """
        with Session(db.engine, autoflush=False) as session:
            credentials = (
                session.query(EndUserAuthenticationProvider)
                .filter_by(end_user_id=end_user_id, tenant_id=tenant_id, provider=provider_id)
                .order_by(EndUserAuthenticationProvider.created_at.asc())
                .all()
            )

            if not credentials:
                return []

            # Get provider controller to access credential schema
            provider_controller = ToolManager.get_builtin_provider(provider_id, tenant_id)

            result: list[ToolProviderCredentialApiEntity] = []
            for credential in credentials:
                try:
                    # Create encrypter for masking credentials
                    encrypter, _ = EndUserAuthService._create_encrypter(
                        tenant_id, provider_controller, credential.credential_type
                    )

                    # Decrypt and mask credentials
                    decrypted = encrypter.decrypt(credential.credentials)
                    masked_credentials = encrypter.mask_plugin_credentials(decrypted)

                    # Convert to API entity
                    credential_entity = ToolTransformService.convert_enduser_provider_to_credential_entity(
                        provider=credential,
                        credentials=dict(masked_credentials),
                    )
                    result.append(credential_entity)
                except Exception:
                    logger.exception("Error processing credential %s", credential.id)
                    continue

            return result

    @staticmethod
    def get_credential(
        credential_id: str, end_user_id: str, tenant_id: str, mask_credentials: bool = True
    ) -> ToolProviderCredentialApiEntity | None:
        """
        Get a specific credential by ID.

        :param credential_id: The credential ID
        :param end_user_id: The end user ID
        :param tenant_id: The tenant ID
        :param mask_credentials: Whether to mask secret fields
        :return: Credential entity or None
        """
        with Session(db.engine, autoflush=False) as session:
            credential = (
                session.query(EndUserAuthenticationProvider)
                .filter_by(id=credential_id, end_user_id=end_user_id, tenant_id=tenant_id)
                .first()
            )

            if not credential:
                return None

            # Get provider controller
            provider_controller = ToolManager.get_builtin_provider(credential.provider, tenant_id)

            # Create encrypter
            encrypter, _ = EndUserAuthService._create_encrypter(
                tenant_id, provider_controller, credential.credential_type
            )

            # Decrypt credentials
            decrypted = encrypter.decrypt(credential.credentials)

            # Mask if requested
            if mask_credentials:
                decrypted = encrypter.mask_plugin_credentials(decrypted)

            # Convert to API entity
            return ToolTransformService.convert_enduser_provider_to_credential_entity(
                provider=credential,
                credentials=dict(decrypted),
            )

    @staticmethod
    def create_api_key_credential(
        tenant_id: str,
        end_user_id: str,
        provider_id: str,
        credentials: dict,
        name: str | None = None,
    ) -> ToolProviderCredentialApiEntity:
        """
        Create a new API key credential for an end user.

        :param tenant_id: The tenant ID
        :param end_user_id: The end user ID
        :param provider_id: The provider identifier
        :param credentials: The credential data
        :param name: Optional custom name
        :return: Created credential entity
        """
        with Session(db.engine) as session:
            try:
                lock = f"enduser_credential_create_lock:{end_user_id}_{provider_id}"
                with redis_client.lock(lock, timeout=20):
                    # Get provider controller
                    provider_controller = ToolManager.get_builtin_provider(provider_id, tenant_id)
                    if not provider_controller.need_credentials:
                        raise ValueError(f"Provider {provider_id} does not need credentials")

                    # Check credential count
                    credential_count = (
                        session.query(EndUserAuthenticationProvider)
                        .filter_by(end_user_id=end_user_id, tenant_id=tenant_id, provider=provider_id)
                        .count()
                    )

                    if credential_count >= EndUserAuthService.__MAX_CREDENTIALS_PER_PROVIDER__:
                        raise ValueError(
                            f"Maximum number of credentials ({EndUserAuthService.__MAX_CREDENTIALS_PER_PROVIDER__}) "
                            f"reached for provider {provider_id}"
                        )

                    # Validate credentials
                    credential_type = CredentialType.API_KEY
                    if CredentialType.of(credential_type).is_validate_allowed():
                        provider_controller.validate_credentials(end_user_id, credentials)

                    # Generate name if not provided
                    if name is None or name == "":
                        name = EndUserAuthService._generate_credential_name(
                            session=session,
                            end_user_id=end_user_id,
                            tenant_id=tenant_id,
                            provider=provider_id,
                            credential_type=credential_type,
                        )
                    else:
                        # Validate name length
                        if len(name) > 30:
                            raise ValueError("Credential name must be 30 characters or less")

                        # Check if name is already used
                        if session.scalar(
                            select(
                                exists().where(
                                    EndUserAuthenticationProvider.end_user_id == end_user_id,
                                    EndUserAuthenticationProvider.tenant_id == tenant_id,
                                    EndUserAuthenticationProvider.provider == provider_id,
                                    EndUserAuthenticationProvider.name == name,
                                )
                            )
                        ):
                            raise ValueError(f"The credential name '{name}' is already used")

                    # Create encrypter
                    encrypter, _ = EndUserAuthService._create_encrypter(
                        tenant_id, provider_controller, credential_type
                    )

                    # Create credential record
                    db_credential = EndUserAuthenticationProvider(
                        tenant_id=tenant_id,
                        end_user_id=end_user_id,
                        provider=provider_id,
                        encrypted_credentials=json.dumps(encrypter.encrypt(credentials)),
                        credential_type=credential_type,
                        name=name,
                        expires_at=-1,  # API keys don't expire
                    )

                    session.add(db_credential)
                    session.commit()
                    session.refresh(db_credential)

                    # Return masked credentials
                    masked_credentials = encrypter.mask_plugin_credentials(credentials)
                    return ToolTransformService.convert_enduser_provider_to_credential_entity(
                        provider=db_credential,
                        credentials=dict(masked_credentials),
                    )
            except Exception as e:
                session.rollback()
                logger.exception("Error creating API key credential")
                raise ValueError(str(e))

    @staticmethod
    def create_oauth_credential(
        end_user_id: str,
        tenant_id: str,
        provider: str,
        credentials: dict,
        expires_at: int = -1,
        name: str | None = None,
    ) -> EndUserAuthenticationProvider:
        """
        Create a new OAuth credential for an end user.
        Used internally by OAuth callback handler.

        :param end_user_id: The end user ID
        :param tenant_id: The tenant ID
        :param provider: The provider identifier
        :param credentials: The OAuth credentials (access_token, refresh_token, etc.)
        :param expires_at: Unix timestamp when token expires (-1 for no expiry)
        :param name: Optional custom name
        :return: Created credential record
        """
        with Session(db.engine) as session:
            try:
                lock = f"enduser_credential_create_lock:{end_user_id}_{provider}"
                with redis_client.lock(lock, timeout=20):
                    # Get provider controller
                    provider_controller = ToolManager.get_builtin_provider(provider, tenant_id)

                    # Check credential count
                    credential_count = (
                        session.query(EndUserAuthenticationProvider)
                        .filter_by(end_user_id=end_user_id, tenant_id=tenant_id, provider=provider)
                        .count()
                    )

                    if credential_count >= EndUserAuthService.__MAX_CREDENTIALS_PER_PROVIDER__:
                        raise ValueError(
                            f"Maximum number of credentials ({EndUserAuthService.__MAX_CREDENTIALS_PER_PROVIDER__}) "
                            f"reached for provider {provider}"
                        )

                    # Generate name if not provided
                    credential_type = CredentialType.OAUTH2
                    if name is None or name == "":
                        name = EndUserAuthService._generate_credential_name(
                            session=session,
                            end_user_id=end_user_id,
                            tenant_id=tenant_id,
                            provider=provider,
                            credential_type=credential_type,
                        )

                    # Create encrypter
                    encrypter, _ = EndUserAuthService._create_encrypter(
                        tenant_id, provider_controller, credential_type
                    )

                    # Create credential record
                    db_credential = EndUserAuthenticationProvider(
                        tenant_id=tenant_id,
                        end_user_id=end_user_id,
                        provider=provider,
                        encrypted_credentials=json.dumps(encrypter.encrypt(credentials)),
                        credential_type=credential_type,
                        name=name,
                        expires_at=expires_at,
                    )

                    session.add(db_credential)
                    session.commit()
                    session.refresh(db_credential)

                    return db_credential
            except Exception as e:
                session.rollback()
                logger.exception("Error creating OAuth credential")
                raise ValueError(str(e))

    @staticmethod
    def update_credential(
        credential_id: str,
        end_user_id: str,
        tenant_id: str,
        credentials: dict | None = None,
        name: str | None = None,
    ) -> ToolProviderCredentialApiEntity:
        """
        Update an existing credential (API key only).

        :param credential_id: The credential ID
        :param end_user_id: The end user ID
        :param tenant_id: The tenant ID
        :param credentials: Updated credentials (optional)
        :param name: Updated name (optional)
        :return: Updated credential entity
        """
        with Session(db.engine) as session:
            try:
                # Get credential
                db_credential = (
                    session.query(EndUserAuthenticationProvider)
                    .filter_by(id=credential_id, end_user_id=end_user_id, tenant_id=tenant_id)
                    .first()
                )

                if not db_credential:
                    raise ValueError(f"Credential {credential_id} not found")

                # Only API key credentials can be updated
                if not CredentialType.of(db_credential.credential_type).is_editable():
                    raise ValueError("Only API key credentials can be updated via this endpoint")

                # At least one field must be provided
                if credentials is None and name is None:
                    raise ValueError("At least one field (credentials or name) must be provided")

                # Get provider controller
                provider_controller = ToolManager.get_builtin_provider(db_credential.provider, tenant_id)

                # Create encrypter
                encrypter, _ = EndUserAuthService._create_encrypter(
                    tenant_id, provider_controller, db_credential.credential_type
                )

                # Update credentials if provided
                if credentials:
                    # Decrypt original credentials
                    original_credentials = encrypter.decrypt(db_credential.credentials)

                    # Merge with new credentials, keeping hidden values
                    new_credentials: dict = {
                        key: value if value != HIDDEN_VALUE else original_credentials.get(key, UNKNOWN_VALUE)
                        for key, value in credentials.items()
                    }

                    # Validate new credentials
                    if CredentialType.of(db_credential.credential_type).is_validate_allowed():
                        provider_controller.validate_credentials(end_user_id, new_credentials)

                    # Encrypt and save
                    db_credential.encrypted_credentials = json.dumps(encrypter.encrypt(new_credentials))

                # Update name if provided
                if name and name != db_credential.name:
                    # Validate name length
                    if len(name) > 30:
                        raise ValueError("Credential name must be 30 characters or less")

                    # Check if name is already used
                    if session.scalar(
                        select(
                            exists().where(
                                EndUserAuthenticationProvider.end_user_id == end_user_id,
                                EndUserAuthenticationProvider.tenant_id == tenant_id,
                                EndUserAuthenticationProvider.provider == db_credential.provider,
                                EndUserAuthenticationProvider.name == name,
                            )
                        )
                    ):
                        raise ValueError(f"The credential name '{name}' is already used")

                    db_credential.name = name

                session.commit()
                session.refresh(db_credential)

                # Return masked credentials
                decrypted = encrypter.decrypt(db_credential.credentials)
                masked_credentials = encrypter.mask_plugin_credentials(decrypted)

                return ToolTransformService.convert_enduser_provider_to_credential_entity(
                    provider=db_credential,
                    credentials=dict(masked_credentials),
                )
            except Exception as e:
                session.rollback()
                logger.exception("Error updating credential")
                raise ValueError(str(e))

    @staticmethod
    def delete_credential(
        tenant_id: str, end_user_id: str, provider_id: str, credential_id: str
    ) -> bool:
        """
        Delete a credential.

        :param credential_id: The credential ID
        :param end_user_id: The end user ID
        :param tenant_id: The tenant ID
        :return: True if deleted successfully
        """
        with Session(db.engine) as session:
            credential = (
                session.query(EndUserAuthenticationProvider)
                .filter_by(id=credential_id, end_user_id=end_user_id, tenant_id=tenant_id)
                .first()
            )

            if not credential:
                raise ValueError(f"Credential {credential_id} not found")

            session.delete(credential)
            session.commit()
            return True

    @staticmethod
    def refresh_oauth_token(
        credential_id: str, end_user_id: str, tenant_id: str, refreshed_credentials: dict, expires_at: int
    ) -> EndUserAuthenticationProvider:
        """
        Update OAuth credentials after token refresh.

        :param credential_id: The credential ID
        :param end_user_id: The end user ID
        :param tenant_id: The tenant ID
        :param refreshed_credentials: New credentials from OAuth refresh
        :param expires_at: New expiration timestamp
        :return: Updated credential record
        """
        with Session(db.engine) as session:
            try:
                credential = (
                    session.query(EndUserAuthenticationProvider)
                    .filter_by(id=credential_id, end_user_id=end_user_id, tenant_id=tenant_id)
                    .first()
                )

                if not credential:
                    raise ValueError(f"Credential {credential_id} not found")

                if credential.credential_type != CredentialType.OAUTH2:
                    raise ValueError("Only OAuth credentials can be refreshed")

                # Get provider controller
                provider_controller = ToolManager.get_builtin_provider(credential.provider, tenant_id)

                # Create encrypter
                encrypter, _ = EndUserAuthService._create_encrypter(
                    tenant_id, provider_controller, credential.credential_type
                )

                # Encrypt and save new credentials
                credential.encrypted_credentials = json.dumps(encrypter.encrypt(refreshed_credentials))
                credential.expires_at = expires_at

                session.commit()
                session.refresh(credential)

                return credential
            except Exception as e:
                session.rollback()
                logger.exception("Error refreshing OAuth token")
                raise ValueError(str(e))

    @staticmethod
    def get_default_credential(
        end_user_id: str, tenant_id: str, provider: str
    ) -> EndUserAuthenticationProvider | None:
        """
        Get the default (oldest) credential for a provider.

        :param end_user_id: The end user ID
        :param tenant_id: The tenant ID
        :param provider: The provider identifier
        :return: Credential record or None
        """
        with Session(db.engine, autoflush=False) as session:
            return (
                session.query(EndUserAuthenticationProvider)
                .filter_by(end_user_id=end_user_id, tenant_id=tenant_id, provider=provider)
                .order_by(EndUserAuthenticationProvider.created_at.asc())
                .first()
            )

    @staticmethod
    def _generate_credential_name(
        session: Session,
        end_user_id: str,
        tenant_id: str,
        provider: str,
        credential_type: CredentialType,
    ) -> str:
        """
        Generate a unique credential name.

        :param session: Database session
        :param end_user_id: The end user ID
        :param tenant_id: The tenant ID
        :param provider: The provider identifier
        :param credential_type: The credential type
        :return: Generated name (e.g., "API KEY 1", "AUTH 1")
        """
        existing_credentials = (
            session.query(EndUserAuthenticationProvider)
            .filter_by(
                end_user_id=end_user_id,
                tenant_id=tenant_id,
                provider=provider,
                credential_type=credential_type,
            )
            .order_by(EndUserAuthenticationProvider.created_at.desc())
            .all()
        )

        return generate_incremental_name(
            [credential.name for credential in existing_credentials],
            f"{credential_type.get_name()}",
        )

    @staticmethod
    def _create_encrypter(
        tenant_id: str, provider_controller, credential_type: CredentialType | str
    ) -> tuple:
        """
        Create an encrypter for credential encryption/decryption.

        :param tenant_id: The tenant ID
        :param provider_controller: The provider controller
        :param credential_type: The credential type
        :return: Tuple of (encrypter, cache)
        """
        if isinstance(credential_type, str):
            credential_type = CredentialType.of(credential_type)

        return create_provider_encrypter(
            tenant_id=tenant_id,
            config=[
                x.to_basic_provider_config()
                for x in provider_controller.get_credentials_schema_by_type(credential_type)
            ],
            cache=NoOpProviderCredentialCache(),
        )
