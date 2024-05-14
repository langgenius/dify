import json

from flask_login import current_user
from werkzeug.exceptions import NotFound

from core.rag.extractor.firecrawl.firecrawl_app import FirecrawlApp
from extensions.ext_database import db
from models.source import DataSourceApiKeyAuthBinding


class WebsiteService:

    @classmethod
    def document_create_args_validate(cls, args: dict):
        if 'url' not in args or not args['url']:
            raise ValueError('url is required')
        if 'options' not in args or not args['options']:
            raise ValueError('options is required')
        if 'limit' not in args['options'] or not args['options']['limit']:
            raise ValueError('limit is required')

    @classmethod
    def crawl_url(cls, args: dict) -> dict:
        provider = args.get('provider')
        url = args.get('url')
        options = args.get('options')
        if provider == 'firecrawl':
            data_source_api_key_bindings = db.session.query(DataSourceApiKeyAuthBinding).filter(
                DataSourceApiKeyAuthBinding.tenant_id == current_user.current_tenant_id,
                DataSourceApiKeyAuthBinding.category == 'website',
                DataSourceApiKeyAuthBinding.provider == 'firecrawl',
                DataSourceApiKeyAuthBinding.disabled.is_(False)
            ).first()
            if not data_source_api_key_bindings:
                raise NotFound('Firecrawl API key not found')
            credentials = json.loads(data_source_api_key_bindings.credentials)
            firecrawl_app = FirecrawlApp(api_key=credentials.get('config').get('api_key'),
                                         base_url=credentials.get('config').get('base_url', None))
            crawl_sub_pages = options.get('crawl_sub_pages', False)
            only_main_content = options.get('only_main_content', False)
            if not crawl_sub_pages:
                params = {
                    'crawlerOptions': {
                        "includes": [],
                        "excludes": [],
                        "generateImgAltText": True,
                        "maxDepth": 1,
                        "limit": 1,
                        'returnOnlyUrls': False,
                        'pageOptions': {
                            'onlyMainContent': only_main_content,
                            "includeHtml": False
                        }
                    }
                }
            else:
                includes = ','.join(options.get('includes')) if options.get('includes') else []
                excludes = ','.join(options.get('excludes')) if options.get('excludes') else []
                params = {
                    'crawlerOptions': {
                        "includes": includes if includes else [],
                        "excludes": excludes if excludes else [],
                        "generateImgAltText": True,
                        "maxDepth": options.get('max_depth', 1),
                        "limit": options.get('limit', 1),
                        'returnOnlyUrls': False,
                        'pageOptions': {
                            'onlyMainContent': only_main_content,
                            "includeHtml": False
                        }
                    }
                }
            job_id = firecrawl_app.crawl_url(url, params)
            return {
                'status': 'active',
                'job_id': job_id
            }
        else:
            raise ValueError('Invalid provider')

    @classmethod
    def get_crawl_status(cls, job_id: str, provider: str) -> dict:
        if provider == 'firecrawl':
            data_source_api_key_bindings = db.session.query(DataSourceApiKeyAuthBinding).filter(
                DataSourceApiKeyAuthBinding.tenant_id == current_user.current_tenant_id,
                DataSourceApiKeyAuthBinding.category == 'website',
                DataSourceApiKeyAuthBinding.provider == 'firecrawl',
                DataSourceApiKeyAuthBinding.disabled.is_(False)
            ).first()
            if not data_source_api_key_bindings:
                raise NotFound('Firecrawl API key not found')
            credentials = json.loads(data_source_api_key_bindings.credentials)
            firecrawl_app = FirecrawlApp(api_key=credentials.get('config').get('api_key'),
                                         base_url=credentials.get('config').get('base_url', None))
            result = firecrawl_app.check_crawl_status(job_id)
            crawl_status_data = {
                'status': result.get('status', 'active'),
                'job_id': job_id,
                'data': result.get('data', [])
            }
        else:
            raise ValueError('Invalid provider')
        return crawl_status_data

    @classmethod
    def get_crawl_url_data(cls, job_id: str, provider: str, url: str) -> dict:
        if provider == 'firecrawl':
            data_source_api_key_bindings = db.session.query(DataSourceApiKeyAuthBinding).filter(
                DataSourceApiKeyAuthBinding.tenant_id == current_user.current_tenant_id,
                DataSourceApiKeyAuthBinding.category == 'website',
                DataSourceApiKeyAuthBinding.provider == 'firecrawl',
                DataSourceApiKeyAuthBinding.disabled.is_(False)
            ).first()
            if not data_source_api_key_bindings:
                raise NotFound('Firecrawl API key not found')
            credentials = json.loads(data_source_api_key_bindings.credentials)
            firecrawl_app = FirecrawlApp(api_key=credentials.get('config').get('api_key'),
                                         base_url=credentials.get('config').get('base_url', None))
            result = firecrawl_app.check_crawl_status(job_id)
            if result.get('status') != 'completed':
                raise ValueError('Crawl job is not completed')
            data = result.get('data')
            for item in data:
                if item.get('data'):
                    if item.get('data').get('metadata').get('sourceURL') == url:
                        return item.get('data').get('markdown')
        else:
            raise ValueError('Invalid provider')