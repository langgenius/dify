from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from services.website_service import (
    CrawlOptions,
    ScrapeRequest,
    WebsiteCrawlApiRequest,
    WebsiteCrawlStatusApiRequest,
    WebsiteService,
)


class TestWebsiteService:
    """Integration tests for WebsiteService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.website_service.ApiKeyAuthService") as mock_api_key_auth_service,
            patch("services.website_service.FirecrawlApp") as mock_firecrawl_app,
            patch("services.website_service.WaterCrawlProvider") as mock_watercrawl_provider,
            patch("services.website_service.requests") as mock_requests,
            patch("services.website_service.redis_client") as mock_redis_client,
            patch("services.website_service.storage") as mock_storage,
            patch("services.website_service.encrypter") as mock_encrypter,
        ):
            # Setup default mock returns
            mock_api_key_auth_service.get_auth_credentials.return_value = {
                "config": {"api_key": "encrypted_api_key", "base_url": "https://api.example.com"}
            }
            mock_encrypter.decrypt_token.return_value = "decrypted_api_key"

            # Mock FirecrawlApp
            mock_firecrawl_instance = MagicMock()
            mock_firecrawl_instance.crawl_url.return_value = "test_job_id_123"
            mock_firecrawl_instance.check_crawl_status.return_value = {
                "status": "completed",
                "total": 5,
                "current": 5,
                "data": [{"source_url": "https://example.com", "title": "Test Page"}],
            }
            mock_firecrawl_app.return_value = mock_firecrawl_instance

            # Mock WaterCrawlProvider
            mock_watercrawl_instance = MagicMock()
            mock_watercrawl_instance.crawl_url.return_value = {"status": "active", "job_id": "watercrawl_job_123"}
            mock_watercrawl_instance.get_crawl_status.return_value = {
                "status": "completed",
                "job_id": "watercrawl_job_123",
                "total": 3,
                "current": 3,
                "data": [],
            }
            mock_watercrawl_instance.get_crawl_url_data.return_value = {
                "title": "WaterCrawl Page",
                "source_url": "https://example.com",
                "description": "Test description",
                "markdown": "# Test Content",
            }
            mock_watercrawl_instance.scrape_url.return_value = {
                "title": "Scraped Page",
                "content": "Test content",
                "url": "https://example.com",
            }
            mock_watercrawl_provider.return_value = mock_watercrawl_instance

            # Mock requests
            mock_response = MagicMock()
            mock_response.json.return_value = {"code": 200, "data": {"taskId": "jina_job_123"}}
            mock_requests.get.return_value = mock_response
            mock_requests.post.return_value = mock_response

            # Mock Redis
            mock_redis_client.setex.return_value = None
            mock_redis_client.get.return_value = str(datetime.now().timestamp())
            mock_redis_client.delete.return_value = None

            # Mock Storage
            mock_storage.exists.return_value = False
            mock_storage.load_once.return_value = None

            yield {
                "api_key_auth_service": mock_api_key_auth_service,
                "firecrawl_app": mock_firecrawl_app,
                "watercrawl_provider": mock_watercrawl_provider,
                "requests": mock_requests,
                "redis_client": mock_redis_client,
                "storage": mock_storage,
                "encrypter": mock_encrypter,
            }

    def _create_test_account(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Helper method to create a test account with proper tenant setup.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            Account: Created account instance
        """
        fake = Faker()

        # Create account
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )

        from extensions.ext_database import db

        db.session.add(account)
        db.session.commit()

        # Create tenant for the account
        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER.value,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

        # Set current tenant for account
        account.current_tenant = tenant

        return account

    def test_document_create_args_validate_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful argument validation for document creation.

        This test verifies:
        - Valid arguments are accepted without errors
        - All required fields are properly validated
        - Optional fields are handled correctly
        """
        # Arrange: Prepare valid arguments
        valid_args = {
            "provider": "firecrawl",
            "url": "https://example.com",
            "options": {
                "limit": 5,
                "crawl_sub_pages": True,
                "only_main_content": False,
                "includes": "blog,news",
                "excludes": "admin,private",
                "max_depth": 3,
                "use_sitemap": True,
            },
        }

        # Act: Validate arguments
        WebsiteService.document_create_args_validate(valid_args)

        # Assert: No exception should be raised
        # If we reach here, validation passed successfully

    def test_document_create_args_validate_missing_provider(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test argument validation fails when provider is missing.

        This test verifies:
        - Missing provider raises ValueError
        - Proper error message is provided
        - Validation stops at first missing required field
        """
        # Arrange: Prepare arguments without provider
        invalid_args = {"url": "https://example.com", "options": {"limit": 5, "crawl_sub_pages": True}}

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError) as exc_info:
            WebsiteService.document_create_args_validate(invalid_args)

        assert "Provider is required" in str(exc_info.value)

    def test_document_create_args_validate_missing_url(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test argument validation fails when URL is missing.

        This test verifies:
        - Missing URL raises ValueError
        - Proper error message is provided
        - Validation continues after provider check
        """
        # Arrange: Prepare arguments without URL
        invalid_args = {"provider": "firecrawl", "options": {"limit": 5, "crawl_sub_pages": True}}

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError) as exc_info:
            WebsiteService.document_create_args_validate(invalid_args)

        assert "URL is required" in str(exc_info.value)

    def test_crawl_url_firecrawl_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful URL crawling with Firecrawl provider.

        This test verifies:
        - Firecrawl provider is properly initialized
        - API credentials are retrieved and decrypted
        - Crawl parameters are correctly formatted
        - Job ID is returned with active status
        - Redis cache is properly set
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)
        fake = Faker()

        # Mock current_user for the test
        with patch("services.website_service.current_user") as mock_current_user:
            mock_current_user.current_tenant_id = account.current_tenant.id

            # Create API request
            api_request = WebsiteCrawlApiRequest(
                provider="firecrawl",
                url="https://example.com",
                options={
                    "limit": 10,
                    "crawl_sub_pages": True,
                    "only_main_content": True,
                    "includes": "blog,news",
                    "excludes": "admin,private",
                    "max_depth": 2,
                    "use_sitemap": True,
                },
            )

            # Act: Execute crawl operation
            result = WebsiteService.crawl_url(api_request)

            # Assert: Verify successful operation
            assert result is not None
            assert result["status"] == "active"
            assert result["job_id"] == "test_job_id_123"

            # Verify external service interactions
            mock_external_service_dependencies["api_key_auth_service"].get_auth_credentials.assert_called_once_with(
                account.current_tenant.id, "website", "firecrawl"
            )
            mock_external_service_dependencies["encrypter"].decrypt_token.assert_called_once_with(
                tenant_id=account.current_tenant.id, token="encrypted_api_key"
            )
            mock_external_service_dependencies["firecrawl_app"].assert_called_once_with(
                api_key="decrypted_api_key", base_url="https://api.example.com"
            )

            # Verify Redis cache was set
            mock_external_service_dependencies["redis_client"].setex.assert_called_once()

    def test_crawl_url_watercrawl_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful URL crawling with WaterCrawl provider.

        This test verifies:
        - WaterCrawl provider is properly initialized
        - API credentials are retrieved and decrypted
        - Crawl options are correctly passed to provider
        - Provider returns expected response format
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock current_user for the test
        with patch("services.website_service.current_user") as mock_current_user:
            mock_current_user.current_tenant_id = account.current_tenant.id

            # Create API request
            api_request = WebsiteCrawlApiRequest(
                provider="watercrawl",
                url="https://example.com",
                options={
                    "limit": 5,
                    "crawl_sub_pages": False,
                    "only_main_content": False,
                    "includes": None,
                    "excludes": None,
                    "max_depth": None,
                    "use_sitemap": False,
                },
            )

            # Act: Execute crawl operation
            result = WebsiteService.crawl_url(api_request)

            # Assert: Verify successful operation
            assert result is not None
            assert result["status"] == "active"
            assert result["job_id"] == "watercrawl_job_123"

            # Verify external service interactions
            mock_external_service_dependencies["api_key_auth_service"].get_auth_credentials.assert_called_once_with(
                account.current_tenant.id, "website", "watercrawl"
            )
            mock_external_service_dependencies["encrypter"].decrypt_token.assert_called_once_with(
                tenant_id=account.current_tenant.id, token="encrypted_api_key"
            )
            mock_external_service_dependencies["watercrawl_provider"].assert_called_once_with(
                api_key="decrypted_api_key", base_url="https://api.example.com"
            )

    def test_crawl_url_jinareader_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful URL crawling with JinaReader provider.

        This test verifies:
        - JinaReader provider handles single page crawling
        - API credentials are retrieved and decrypted
        - HTTP requests are made with proper headers
        - Response is properly parsed and returned
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock current_user for the test
        with patch("services.website_service.current_user") as mock_current_user:
            mock_current_user.current_tenant_id = account.current_tenant.id

            # Create API request for single page crawling
            api_request = WebsiteCrawlApiRequest(
                provider="jinareader",
                url="https://example.com",
                options={
                    "limit": 1,
                    "crawl_sub_pages": False,
                    "only_main_content": True,
                    "includes": None,
                    "excludes": None,
                    "max_depth": None,
                    "use_sitemap": False,
                },
            )

            # Act: Execute crawl operation
            result = WebsiteService.crawl_url(api_request)

            # Assert: Verify successful operation
            assert result is not None
            assert result["status"] == "active"
            assert result["data"] is not None

            # Verify external service interactions
            mock_external_service_dependencies["api_key_auth_service"].get_auth_credentials.assert_called_once_with(
                account.current_tenant.id, "website", "jinareader"
            )
            mock_external_service_dependencies["encrypter"].decrypt_token.assert_called_once_with(
                tenant_id=account.current_tenant.id, token="encrypted_api_key"
            )

            # Verify HTTP request was made
            mock_external_service_dependencies["requests"].get.assert_called_once_with(
                "https://r.jina.ai/https://example.com",
                headers={"Accept": "application/json", "Authorization": "Bearer decrypted_api_key"},
            )

    def test_crawl_url_invalid_provider(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test crawl operation fails with invalid provider.

        This test verifies:
        - Invalid provider raises ValueError
        - Proper error message is provided
        - Service handles unsupported providers gracefully
        """
        # Arrange: Create test account and prepare request with invalid provider
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock current_user for the test
        with patch("services.website_service.current_user") as mock_current_user:
            mock_current_user.current_tenant_id = account.current_tenant.id

            # Create API request with invalid provider
            api_request = WebsiteCrawlApiRequest(
                provider="invalid_provider",
                url="https://example.com",
                options={"limit": 5, "crawl_sub_pages": False, "only_main_content": False},
            )

            # Act & Assert: Verify proper error handling
            with pytest.raises(ValueError) as exc_info:
                WebsiteService.crawl_url(api_request)

            assert "Invalid provider" in str(exc_info.value)

    def test_get_crawl_status_firecrawl_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful crawl status retrieval with Firecrawl provider.

        This test verifies:
        - Firecrawl status is properly retrieved
        - API credentials are retrieved and decrypted
        - Status data includes all required fields
        - Redis cache is properly managed for completed jobs
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock current_user for the test
        with patch("services.website_service.current_user") as mock_current_user:
            mock_current_user.current_tenant_id = account.current_tenant.id

            # Create API request
            api_request = WebsiteCrawlStatusApiRequest(provider="firecrawl", job_id="test_job_id_123")

            # Act: Get crawl status
            result = WebsiteService.get_crawl_status_typed(api_request)

            # Assert: Verify successful operation
            assert result is not None
            assert result["status"] == "completed"
            assert result["job_id"] == "test_job_id_123"
            assert result["total"] == 5
            assert result["current"] == 5
            assert "data" in result
            assert "time_consuming" in result

            # Verify external service interactions
            mock_external_service_dependencies["api_key_auth_service"].get_auth_credentials.assert_called_once_with(
                account.current_tenant.id, "website", "firecrawl"
            )
            mock_external_service_dependencies["encrypter"].decrypt_token.assert_called_once_with(
                tenant_id=account.current_tenant.id, token="encrypted_api_key"
            )

            # Verify Redis cache was accessed and cleaned up
            mock_external_service_dependencies["redis_client"].get.assert_called_once()
            mock_external_service_dependencies["redis_client"].delete.assert_called_once()

    def test_get_crawl_status_watercrawl_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful crawl status retrieval with WaterCrawl provider.

        This test verifies:
        - WaterCrawl status is properly retrieved
        - API credentials are retrieved and decrypted
        - Provider returns expected status format
        - All required status fields are present
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock current_user for the test
        with patch("services.website_service.current_user") as mock_current_user:
            mock_current_user.current_tenant_id = account.current_tenant.id

            # Create API request
            api_request = WebsiteCrawlStatusApiRequest(provider="watercrawl", job_id="watercrawl_job_123")

            # Act: Get crawl status
            result = WebsiteService.get_crawl_status_typed(api_request)

            # Assert: Verify successful operation
            assert result is not None
            assert result["status"] == "completed"
            assert result["job_id"] == "watercrawl_job_123"
            assert result["total"] == 3
            assert result["current"] == 3
            assert "data" in result

            # Verify external service interactions
            mock_external_service_dependencies["api_key_auth_service"].get_auth_credentials.assert_called_once_with(
                account.current_tenant.id, "website", "watercrawl"
            )
            mock_external_service_dependencies["encrypter"].decrypt_token.assert_called_once_with(
                tenant_id=account.current_tenant.id, token="encrypted_api_key"
            )

    def test_get_crawl_status_jinareader_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful crawl status retrieval with JinaReader provider.

        This test verifies:
        - JinaReader status is properly retrieved
        - API credentials are retrieved and decrypted
        - HTTP requests are made with proper parameters
        - Status data is properly formatted and returned
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock current_user for the test
        with patch("services.website_service.current_user") as mock_current_user:
            mock_current_user.current_tenant_id = account.current_tenant.id

            # Create API request
            api_request = WebsiteCrawlStatusApiRequest(provider="jinareader", job_id="jina_job_123")

            # Act: Get crawl status
            result = WebsiteService.get_crawl_status_typed(api_request)

            # Assert: Verify successful operation
            assert result is not None
            assert result["status"] == "active"
            assert result["job_id"] == "jina_job_123"
            assert "total" in result
            assert "current" in result
            assert "data" in result
            assert "time_consuming" in result

            # Verify external service interactions
            mock_external_service_dependencies["api_key_auth_service"].get_auth_credentials.assert_called_once_with(
                account.current_tenant.id, "website", "jinareader"
            )
            mock_external_service_dependencies["encrypter"].decrypt_token.assert_called_once_with(
                tenant_id=account.current_tenant.id, token="encrypted_api_key"
            )

            # Verify HTTP request was made
            mock_external_service_dependencies["requests"].post.assert_called_once()

    def test_get_crawl_status_invalid_provider(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test crawl status retrieval fails with invalid provider.

        This test verifies:
        - Invalid provider raises ValueError
        - Proper error message is provided
        - Service handles unsupported providers gracefully
        """
        # Arrange: Create test account and prepare request with invalid provider
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock current_user for the test
        with patch("services.website_service.current_user") as mock_current_user:
            mock_current_user.current_tenant_id = account.current_tenant.id

            # Create API request with invalid provider
            api_request = WebsiteCrawlStatusApiRequest(provider="invalid_provider", job_id="test_job_id_123")

            # Act & Assert: Verify proper error handling
            with pytest.raises(ValueError) as exc_info:
                WebsiteService.get_crawl_status_typed(api_request)

            assert "Invalid provider" in str(exc_info.value)

    def test_get_crawl_status_missing_credentials(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test crawl status retrieval fails when credentials are missing.

        This test verifies:
        - Missing credentials raises ValueError
        - Proper error message is provided
        - Service handles authentication failures gracefully
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock current_user for the test
        with patch("services.website_service.current_user") as mock_current_user:
            mock_current_user.current_tenant_id = account.current_tenant.id

            # Mock missing credentials
            mock_external_service_dependencies["api_key_auth_service"].get_auth_credentials.return_value = None

            # Create API request
            api_request = WebsiteCrawlStatusApiRequest(provider="firecrawl", job_id="test_job_id_123")

            # Act & Assert: Verify proper error handling
            with pytest.raises(ValueError) as exc_info:
                WebsiteService.get_crawl_status_typed(api_request)

            assert "No valid credentials found for the provider" in str(exc_info.value)

    def test_get_crawl_status_missing_api_key(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test crawl status retrieval fails when API key is missing from config.

        This test verifies:
        - Missing API key raises ValueError
        - Proper error message is provided
        - Service handles configuration failures gracefully
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock current_user for the test
        with patch("services.website_service.current_user") as mock_current_user:
            mock_current_user.current_tenant_id = account.current_tenant.id

            # Mock missing API key in config
            mock_external_service_dependencies["api_key_auth_service"].get_auth_credentials.return_value = {
                "config": {"base_url": "https://api.example.com"}
            }

            # Create API request
            api_request = WebsiteCrawlStatusApiRequest(provider="firecrawl", job_id="test_job_id_123")

            # Act & Assert: Verify proper error handling
            with pytest.raises(ValueError) as exc_info:
                WebsiteService.get_crawl_status_typed(api_request)

            assert "API key not found in configuration" in str(exc_info.value)

    def test_get_crawl_url_data_firecrawl_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful URL data retrieval with Firecrawl provider.

        This test verifies:
        - Firecrawl URL data is properly retrieved
        - API credentials are retrieved and decrypted
        - Data is returned for matching URL
        - Storage fallback works when needed
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock storage to return existing data
        mock_external_service_dependencies["storage"].exists.return_value = True
        mock_external_service_dependencies["storage"].load_once.return_value = (
            b"["
            b'{"source_url": "https://example.com", "title": "Test Page", '
            b'"description": "Test Description", "markdown": "# Test Content"}'
            b"]"
        )

        # Act: Get URL data
        result = WebsiteService.get_crawl_url_data(
            job_id="test_job_id_123",
            provider="firecrawl",
            url="https://example.com",
            tenant_id=account.current_tenant.id,
        )

        # Assert: Verify successful operation
        assert result is not None
        assert result["source_url"] == "https://example.com"
        assert result["title"] == "Test Page"
        assert result["description"] == "Test Description"
        assert result["markdown"] == "# Test Content"

        # Verify external service interactions
        mock_external_service_dependencies["api_key_auth_service"].get_auth_credentials.assert_called_once_with(
            account.current_tenant.id, "website", "firecrawl"
        )
        mock_external_service_dependencies["encrypter"].decrypt_token.assert_called_once_with(
            tenant_id=account.current_tenant.id, token="encrypted_api_key"
        )

        # Verify storage was accessed
        mock_external_service_dependencies["storage"].exists.assert_called_once()
        mock_external_service_dependencies["storage"].load_once.assert_called_once()

    def test_get_crawl_url_data_watercrawl_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful URL data retrieval with WaterCrawl provider.

        This test verifies:
        - WaterCrawl URL data is properly retrieved
        - API credentials are retrieved and decrypted
        - Provider returns expected data format
        - All required data fields are present
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Act: Get URL data
        result = WebsiteService.get_crawl_url_data(
            job_id="watercrawl_job_123",
            provider="watercrawl",
            url="https://example.com",
            tenant_id=account.current_tenant.id,
        )

        # Assert: Verify successful operation
        assert result is not None
        assert result["title"] == "WaterCrawl Page"
        assert result["source_url"] == "https://example.com"
        assert result["description"] == "Test description"
        assert result["markdown"] == "# Test Content"

        # Verify external service interactions
        mock_external_service_dependencies["api_key_auth_service"].get_auth_credentials.assert_called_once_with(
            account.current_tenant.id, "website", "watercrawl"
        )
        mock_external_service_dependencies["encrypter"].decrypt_token.assert_called_once_with(
            tenant_id=account.current_tenant.id, token="encrypted_api_key"
        )

    def test_get_crawl_url_data_jinareader_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful URL data retrieval with JinaReader provider.

        This test verifies:
        - JinaReader URL data is properly retrieved
        - API credentials are retrieved and decrypted
        - HTTP requests are made with proper parameters
        - Data is properly formatted and returned
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock successful response for JinaReader
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "code": 200,
            "data": {
                "title": "JinaReader Page",
                "url": "https://example.com",
                "description": "Test description",
                "content": "# Test Content",
            },
        }
        mock_external_service_dependencies["requests"].get.return_value = mock_response

        # Act: Get URL data without job_id (single page scraping)
        result = WebsiteService.get_crawl_url_data(
            job_id="", provider="jinareader", url="https://example.com", tenant_id=account.current_tenant.id
        )

        # Assert: Verify successful operation
        assert result is not None
        assert result["title"] == "JinaReader Page"
        assert result["url"] == "https://example.com"
        assert result["description"] == "Test description"
        assert result["content"] == "# Test Content"

        # Verify external service interactions
        mock_external_service_dependencies["api_key_auth_service"].get_auth_credentials.assert_called_once_with(
            account.current_tenant.id, "website", "jinareader"
        )
        mock_external_service_dependencies["encrypter"].decrypt_token.assert_called_once_with(
            tenant_id=account.current_tenant.id, token="encrypted_api_key"
        )

        # Verify HTTP request was made
        mock_external_service_dependencies["requests"].get.assert_called_once_with(
            "https://r.jina.ai/https://example.com",
            headers={"Accept": "application/json", "Authorization": "Bearer decrypted_api_key"},
        )

    def test_get_scrape_url_data_firecrawl_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful URL scraping with Firecrawl provider.

        This test verifies:
        - Firecrawl scraping is properly executed
        - API credentials are retrieved and decrypted
        - Scraping parameters are correctly passed
        - Scraped data is returned in expected format
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock FirecrawlApp scraping response
        mock_firecrawl_instance = MagicMock()
        mock_firecrawl_instance.scrape_url.return_value = {
            "title": "Scraped Page Title",
            "content": "This is the scraped content",
            "url": "https://example.com",
            "description": "Page description",
        }
        mock_external_service_dependencies["firecrawl_app"].return_value = mock_firecrawl_instance

        # Act: Scrape URL
        result = WebsiteService.get_scrape_url_data(
            provider="firecrawl", url="https://example.com", tenant_id=account.current_tenant.id, only_main_content=True
        )

        # Assert: Verify successful operation
        assert result is not None
        assert result["title"] == "Scraped Page Title"
        assert result["content"] == "This is the scraped content"
        assert result["url"] == "https://example.com"
        assert result["description"] == "Page description"

        # Verify external service interactions
        mock_external_service_dependencies["api_key_auth_service"].get_auth_credentials.assert_called_once_with(
            account.current_tenant.id, "website", "firecrawl"
        )
        mock_external_service_dependencies["encrypter"].decrypt_token.assert_called_once_with(
            tenant_id=account.current_tenant.id, token="encrypted_api_key"
        )

        # Verify FirecrawlApp was called with correct parameters
        mock_external_service_dependencies["firecrawl_app"].assert_called_once_with(
            api_key="decrypted_api_key", base_url="https://api.example.com"
        )
        mock_firecrawl_instance.scrape_url.assert_called_once_with(
            url="https://example.com", params={"onlyMainContent": True}
        )

    def test_get_scrape_url_data_watercrawl_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful URL scraping with WaterCrawl provider.

        This test verifies:
        - WaterCrawl scraping is properly executed
        - API credentials are retrieved and decrypted
        - Provider returns expected scraping format
        - All required data fields are present
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Act: Scrape URL
        result = WebsiteService.get_scrape_url_data(
            provider="watercrawl",
            url="https://example.com",
            tenant_id=account.current_tenant.id,
            only_main_content=False,
        )

        # Assert: Verify successful operation
        assert result is not None
        assert result["title"] == "Scraped Page"
        assert result["content"] == "Test content"
        assert result["url"] == "https://example.com"

        # Verify external service interactions
        mock_external_service_dependencies["api_key_auth_service"].get_auth_credentials.assert_called_once_with(
            account.current_tenant.id, "website", "watercrawl"
        )
        mock_external_service_dependencies["encrypter"].decrypt_token.assert_called_once_with(
            tenant_id=account.current_tenant.id, token="encrypted_api_key"
        )

        # Verify WaterCrawlProvider was called with correct parameters
        mock_external_service_dependencies["watercrawl_provider"].assert_called_once_with(
            api_key="decrypted_api_key", base_url="https://api.example.com"
        )

    def test_get_scrape_url_data_invalid_provider(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test URL scraping fails with invalid provider.

        This test verifies:
        - Invalid provider raises ValueError
        - Proper error message is provided
        - Service handles unsupported providers gracefully
        """
        # Arrange: Create test account and prepare request with invalid provider
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError) as exc_info:
            WebsiteService.get_scrape_url_data(
                provider="invalid_provider",
                url="https://example.com",
                tenant_id=account.current_tenant.id,
                only_main_content=False,
            )

        assert "Invalid provider" in str(exc_info.value)

    def test_crawl_options_include_exclude_paths(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test CrawlOptions include and exclude path methods.

        This test verifies:
        - Include paths are properly parsed from comma-separated string
        - Exclude paths are properly parsed from comma-separated string
        - Empty or None values are handled correctly
        - Path lists are returned in expected format
        """
        # Arrange: Create CrawlOptions with various path configurations
        options_with_paths = CrawlOptions(includes="blog,news,articles", excludes="admin,private,test")

        options_without_paths = CrawlOptions(includes=None, excludes="")

        # Act: Get include and exclude paths
        include_paths = options_with_paths.get_include_paths()
        exclude_paths = options_with_paths.get_exclude_paths()

        empty_include_paths = options_without_paths.get_include_paths()
        empty_exclude_paths = options_without_paths.get_exclude_paths()

        # Assert: Verify path parsing
        assert include_paths == ["blog", "news", "articles"]
        assert exclude_paths == ["admin", "private", "test"]
        assert empty_include_paths == []
        assert empty_exclude_paths == []

    def test_website_crawl_api_request_conversion(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test WebsiteCrawlApiRequest conversion to CrawlRequest.

        This test verifies:
        - API request is properly converted to internal CrawlRequest
        - All options are correctly mapped
        - Default values are applied when options are missing
        - Conversion maintains data integrity
        """
        # Arrange: Create API request with various options
        api_request = WebsiteCrawlApiRequest(
            provider="firecrawl",
            url="https://example.com",
            options={
                "limit": 10,
                "crawl_sub_pages": True,
                "only_main_content": True,
                "includes": "blog,news",
                "excludes": "admin,private",
                "max_depth": 3,
                "use_sitemap": False,
            },
        )

        # Act: Convert to CrawlRequest
        crawl_request = api_request.to_crawl_request()

        # Assert: Verify conversion
        assert crawl_request.url == "https://example.com"
        assert crawl_request.provider == "firecrawl"
        assert crawl_request.options.limit == 10
        assert crawl_request.options.crawl_sub_pages is True
        assert crawl_request.options.only_main_content is True
        assert crawl_request.options.includes == "blog,news"
        assert crawl_request.options.excludes == "admin,private"
        assert crawl_request.options.max_depth == 3
        assert crawl_request.options.use_sitemap is False

    def test_website_crawl_api_request_from_args(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test WebsiteCrawlApiRequest creation from Flask arguments.

        This test verifies:
        - Request is properly created from parsed arguments
        - Required fields are validated
        - Optional fields are handled correctly
        - Validation errors are properly raised
        """
        # Arrange: Prepare valid arguments
        valid_args = {"provider": "watercrawl", "url": "https://example.com", "options": {"limit": 5}}

        # Act: Create request from args
        request = WebsiteCrawlApiRequest.from_args(valid_args)

        # Assert: Verify request creation
        assert request.provider == "watercrawl"
        assert request.url == "https://example.com"
        assert request.options == {"limit": 5}

        # Test missing provider
        invalid_args = {"url": "https://example.com", "options": {}}
        with pytest.raises(ValueError) as exc_info:
            WebsiteCrawlApiRequest.from_args(invalid_args)
        assert "Provider is required" in str(exc_info.value)

        # Test missing URL
        invalid_args = {"provider": "watercrawl", "options": {}}
        with pytest.raises(ValueError) as exc_info:
            WebsiteCrawlApiRequest.from_args(invalid_args)
        assert "URL is required" in str(exc_info.value)

        # Test missing options
        invalid_args = {"provider": "watercrawl", "url": "https://example.com"}
        with pytest.raises(ValueError) as exc_info:
            WebsiteCrawlApiRequest.from_args(invalid_args)
        assert "Options are required" in str(exc_info.value)

    def test_crawl_url_jinareader_sub_pages_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful URL crawling with JinaReader provider for sub-pages.

        This test verifies:
        - JinaReader provider handles sub-page crawling correctly
        - HTTP POST request is made with proper parameters
        - Job ID is returned for multi-page crawling
        - All required parameters are passed correctly
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock current_user for the test
        with patch("services.website_service.current_user") as mock_current_user:
            mock_current_user.current_tenant_id = account.current_tenant.id

            # Create API request for sub-page crawling
            api_request = WebsiteCrawlApiRequest(
                provider="jinareader",
                url="https://example.com",
                options={
                    "limit": 5,
                    "crawl_sub_pages": True,
                    "only_main_content": False,
                    "includes": None,
                    "excludes": None,
                    "max_depth": None,
                    "use_sitemap": True,
                },
            )

            # Act: Execute crawl operation
            result = WebsiteService.crawl_url(api_request)

            # Assert: Verify successful operation
            assert result is not None
            assert result["status"] == "active"
            assert result["job_id"] == "jina_job_123"

            # Verify external service interactions
            mock_external_service_dependencies["api_key_auth_service"].get_auth_credentials.assert_called_once_with(
                account.current_tenant.id, "website", "jinareader"
            )
            mock_external_service_dependencies["encrypter"].decrypt_token.assert_called_once_with(
                tenant_id=account.current_tenant.id, token="encrypted_api_key"
            )

            # Verify HTTP POST request was made for sub-page crawling
            mock_external_service_dependencies["requests"].post.assert_called_once_with(
                "https://adaptivecrawl-kir3wx7b3a-uc.a.run.app",
                json={"url": "https://example.com", "maxPages": 5, "useSitemap": True},
                headers={"Content-Type": "application/json", "Authorization": "Bearer decrypted_api_key"},
            )

    def test_crawl_url_jinareader_failed_response(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test JinaReader crawling fails when API returns error.

        This test verifies:
        - Failed API response raises ValueError
        - Proper error message is provided
        - Service handles API failures gracefully
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock failed response
        mock_failed_response = MagicMock()
        mock_failed_response.json.return_value = {"code": 500, "error": "Internal server error"}
        mock_external_service_dependencies["requests"].get.return_value = mock_failed_response

        # Mock current_user for the test
        with patch("services.website_service.current_user") as mock_current_user:
            mock_current_user.current_tenant_id = account.current_tenant.id

            # Create API request
            api_request = WebsiteCrawlApiRequest(
                provider="jinareader",
                url="https://example.com",
                options={"limit": 1, "crawl_sub_pages": False, "only_main_content": True},
            )

            # Act & Assert: Verify proper error handling
            with pytest.raises(ValueError) as exc_info:
                WebsiteService.crawl_url(api_request)

            assert "Failed to crawl" in str(exc_info.value)

    def test_get_crawl_status_firecrawl_active_job(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test Firecrawl status retrieval for active (not completed) job.

        This test verifies:
        - Active job status is properly returned
        - Redis cache is not deleted for active jobs
        - Time consuming is not calculated for active jobs
        - All required status fields are present
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock active job status
        mock_firecrawl_instance = MagicMock()
        mock_firecrawl_instance.check_crawl_status.return_value = {
            "status": "active",
            "total": 10,
            "current": 3,
            "data": [],
        }
        mock_external_service_dependencies["firecrawl_app"].return_value = mock_firecrawl_instance

        # Mock current_user for the test
        with patch("services.website_service.current_user") as mock_current_user:
            mock_current_user.current_tenant_id = account.current_tenant.id

            # Create API request
            api_request = WebsiteCrawlStatusApiRequest(provider="firecrawl", job_id="active_job_123")

            # Act: Get crawl status
            result = WebsiteService.get_crawl_status_typed(api_request)

            # Assert: Verify active job status
            assert result is not None
            assert result["status"] == "active"
            assert result["job_id"] == "active_job_123"
            assert result["total"] == 10
            assert result["current"] == 3
            assert "data" in result
            assert "time_consuming" not in result

            # Verify Redis cache was not accessed for active jobs
            mock_external_service_dependencies["redis_client"].get.assert_not_called()
            mock_external_service_dependencies["redis_client"].delete.assert_not_called()

    def test_get_crawl_url_data_firecrawl_storage_fallback(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test Firecrawl URL data retrieval with storage fallback.

        This test verifies:
        - Storage fallback works when storage has data
        - API call is not made when storage has data
        - Data is properly parsed from storage
        - Correct URL data is returned
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock storage to return existing data
        mock_external_service_dependencies["storage"].exists.return_value = True
        mock_external_service_dependencies["storage"].load_once.return_value = (
            b"["
            b'{"source_url": "https://example.com/page1", '
            b'"title": "Page 1", "description": "Description 1", "markdown": "# Page 1"}, '
            b'{"source_url": "https://example.com/page2", "title": "Page 2", '
            b'"description": "Description 2", "markdown": "# Page 2"}'
            b"]"
        )

        # Act: Get URL data for specific URL
        result = WebsiteService.get_crawl_url_data(
            job_id="test_job_id_123",
            provider="firecrawl",
            url="https://example.com/page1",
            tenant_id=account.current_tenant.id,
        )

        # Assert: Verify successful operation
        assert result is not None
        assert result["source_url"] == "https://example.com/page1"
        assert result["title"] == "Page 1"
        assert result["description"] == "Description 1"
        assert result["markdown"] == "# Page 1"

        # Verify storage was accessed
        mock_external_service_dependencies["storage"].exists.assert_called_once()
        mock_external_service_dependencies["storage"].load_once.assert_called_once()

    def test_get_crawl_url_data_firecrawl_api_fallback(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test Firecrawl URL data retrieval with API fallback when storage is empty.

        This test verifies:
        - API fallback works when storage has no data
        - FirecrawlApp is called to get data
        - Completed job status is checked
        - Data is returned from API response
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock storage to return no data
        mock_external_service_dependencies["storage"].exists.return_value = False

        # Mock FirecrawlApp for API fallback
        mock_firecrawl_instance = MagicMock()
        mock_firecrawl_instance.check_crawl_status.return_value = {
            "status": "completed",
            "data": [
                {
                    "source_url": "https://example.com/api_page",
                    "title": "API Page",
                    "description": "API Description",
                    "markdown": "# API Content",
                }
            ],
        }
        mock_external_service_dependencies["firecrawl_app"].return_value = mock_firecrawl_instance

        # Act: Get URL data
        result = WebsiteService.get_crawl_url_data(
            job_id="test_job_id_123",
            provider="firecrawl",
            url="https://example.com/api_page",
            tenant_id=account.current_tenant.id,
        )

        # Assert: Verify successful operation
        assert result is not None
        assert result["source_url"] == "https://example.com/api_page"
        assert result["title"] == "API Page"
        assert result["description"] == "API Description"
        assert result["markdown"] == "# API Content"

        # Verify API was called
        mock_external_service_dependencies["firecrawl_app"].assert_called_once()

    def test_get_crawl_url_data_firecrawl_incomplete_job(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test Firecrawl URL data retrieval fails for incomplete job.

        This test verifies:
        - Incomplete job raises ValueError
        - Proper error message is provided
        - Service handles incomplete jobs gracefully
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock storage to return no data
        mock_external_service_dependencies["storage"].exists.return_value = False

        # Mock incomplete job status
        mock_firecrawl_instance = MagicMock()
        mock_firecrawl_instance.check_crawl_status.return_value = {"status": "active", "data": []}
        mock_external_service_dependencies["firecrawl_app"].return_value = mock_firecrawl_instance

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError) as exc_info:
            WebsiteService.get_crawl_url_data(
                job_id="test_job_id_123",
                provider="firecrawl",
                url="https://example.com/page",
                tenant_id=account.current_tenant.id,
            )

        assert "Crawl job is not completed" in str(exc_info.value)

    def test_get_crawl_url_data_jinareader_with_job_id(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test JinaReader URL data retrieval with job ID for multi-page crawling.

        This test verifies:
        - JinaReader handles job ID-based data retrieval
        - Status check is performed before data retrieval
        - Processed data is properly formatted
        - Correct URL data is returned
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock successful status response
        mock_status_response = MagicMock()
        mock_status_response.json.return_value = {
            "code": 200,
            "data": {
                "status": "completed",
                "processed": {
                    "https://example.com/page1": {
                        "data": {
                            "title": "Page 1",
                            "url": "https://example.com/page1",
                            "description": "Description 1",
                            "content": "# Content 1",
                        }
                    }
                },
            },
        }
        mock_external_service_dependencies["requests"].post.return_value = mock_status_response

        # Act: Get URL data with job ID
        result = WebsiteService.get_crawl_url_data(
            job_id="jina_job_123",
            provider="jinareader",
            url="https://example.com/page1",
            tenant_id=account.current_tenant.id,
        )

        # Assert: Verify successful operation
        assert result is not None
        assert result["title"] == "Page 1"
        assert result["url"] == "https://example.com/page1"
        assert result["description"] == "Description 1"
        assert result["content"] == "# Content 1"

        # Verify HTTP requests were made
        assert mock_external_service_dependencies["requests"].post.call_count == 2

    def test_get_crawl_url_data_jinareader_incomplete_job(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test JinaReader URL data retrieval fails for incomplete job.

        This test verifies:
        - Incomplete job raises ValueError
        - Proper error message is provided
        - Service handles incomplete jobs gracefully
        """
        # Arrange: Create test account and prepare request
        account = self._create_test_account(db_session_with_containers, mock_external_service_dependencies)

        # Mock incomplete job status
        mock_status_response = MagicMock()
        mock_status_response.json.return_value = {"code": 200, "data": {"status": "active", "processed": {}}}
        mock_external_service_dependencies["requests"].post.return_value = mock_status_response

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError) as exc_info:
            WebsiteService.get_crawl_url_data(
                job_id="jina_job_123",
                provider="jinareader",
                url="https://example.com/page",
                tenant_id=account.current_tenant.id,
            )

        assert "Crawl job is not completed" in str(exc_info.value)

    def test_crawl_options_default_values(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test CrawlOptions default values and initialization.

        This test verifies:
        - Default values are properly set
        - Optional fields can be None
        - Boolean fields have correct defaults
        - Integer fields have correct defaults
        """
        # Arrange: Create CrawlOptions with minimal parameters
        options = CrawlOptions()

        # Assert: Verify default values
        assert options.limit == 1
        assert options.crawl_sub_pages is False
        assert options.only_main_content is False
        assert options.includes is None
        assert options.excludes is None
        assert options.max_depth is None
        assert options.use_sitemap is True

        # Test with custom values
        custom_options = CrawlOptions(
            limit=10,
            crawl_sub_pages=True,
            only_main_content=True,
            includes="blog,news",
            excludes="admin",
            max_depth=3,
            use_sitemap=False,
        )

        assert custom_options.limit == 10
        assert custom_options.crawl_sub_pages is True
        assert custom_options.only_main_content is True
        assert custom_options.includes == "blog,news"
        assert custom_options.excludes == "admin"
        assert custom_options.max_depth == 3
        assert custom_options.use_sitemap is False

    def test_website_crawl_status_api_request_from_args(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test WebsiteCrawlStatusApiRequest creation from Flask arguments.

        This test verifies:
        - Request is properly created from parsed arguments
        - Required fields are validated
        - Job ID is properly handled
        - Validation errors are properly raised
        """
        # Arrange: Prepare valid arguments
        valid_args = {"provider": "firecrawl"}
        job_id = "test_job_123"

        # Act: Create request from args
        request = WebsiteCrawlStatusApiRequest.from_args(valid_args, job_id)

        # Assert: Verify request creation
        assert request.provider == "firecrawl"
        assert request.job_id == "test_job_123"

        # Test missing provider
        invalid_args = {}
        with pytest.raises(ValueError) as exc_info:
            WebsiteCrawlStatusApiRequest.from_args(invalid_args, job_id)
        assert "Provider is required" in str(exc_info.value)

        # Test missing job ID
        with pytest.raises(ValueError) as exc_info:
            WebsiteCrawlStatusApiRequest.from_args(valid_args, "")
        assert "Job ID is required" in str(exc_info.value)

    def test_scrape_request_initialization(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test ScrapeRequest dataclass initialization and properties.

        This test verifies:
        - ScrapeRequest is properly initialized
        - All fields are correctly set
        - Boolean field works correctly
        - String fields are properly assigned
        """
        # Arrange: Create ScrapeRequest
        request = ScrapeRequest(
            provider="firecrawl", url="https://example.com", tenant_id="tenant_123", only_main_content=True
        )

        # Assert: Verify initialization
        assert request.provider == "firecrawl"
        assert request.url == "https://example.com"
        assert request.tenant_id == "tenant_123"
        assert request.only_main_content is True

        # Test with different values
        request2 = ScrapeRequest(
            provider="watercrawl", url="https://test.com", tenant_id="tenant_456", only_main_content=False
        )

        assert request2.provider == "watercrawl"
        assert request2.url == "https://test.com"
        assert request2.tenant_id == "tenant_456"
        assert request2.only_main_content is False
