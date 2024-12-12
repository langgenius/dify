import datetime
import json
from typing import Any

import requests
from flask_login import current_user  # type: ignore

from core.helper import encrypter
from core.rag.extractor.firecrawl.firecrawl_app import FirecrawlApp
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from services.auth.api_key_auth_service import ApiKeyAuthService


class WebsiteService:
    @classmethod
    def document_create_args_validate(cls, args: dict):
        if "url" not in args or not args["url"]:
            raise ValueError("url is required")
        if "options" not in args or not args["options"]:
            raise ValueError("options is required")
        if "limit" not in args["options"] or not args["options"]["limit"]:
            raise ValueError("limit is required")

    @classmethod
    def crawl_url(cls, args: dict) -> dict:
        provider = args.get("provider", "")
        url = args.get("url")
        options = args.get("options", "")
        credentials = ApiKeyAuthService.get_auth_credentials(current_user.current_tenant_id, "website", provider)
        if provider == "firecrawl":
            # decrypt api_key
            api_key = encrypter.decrypt_token(
                tenant_id=current_user.current_tenant_id, token=credentials.get("config").get("api_key")
            )
            firecrawl_app = FirecrawlApp(api_key=api_key, base_url=credentials.get("config").get("base_url", None))
            crawl_sub_pages = options.get("crawl_sub_pages", False)
            only_main_content = options.get("only_main_content", False)
            if not crawl_sub_pages:
                params = {
                    "crawlerOptions": {
                        "includes": [],
                        "excludes": [],
                        "generateImgAltText": True,
                        "limit": 1,
                        "returnOnlyUrls": False,
                        "pageOptions": {"onlyMainContent": only_main_content, "includeHtml": False},
                    }
                }
            else:
                includes = options.get("includes").split(",") if options.get("includes") else []
                excludes = options.get("excludes").split(",") if options.get("excludes") else []
                params = {
                    "crawlerOptions": {
                        "includes": includes,
                        "excludes": excludes,
                        "generateImgAltText": True,
                        "limit": options.get("limit", 1),
                        "returnOnlyUrls": False,
                        "pageOptions": {"onlyMainContent": only_main_content, "includeHtml": False},
                    }
                }
                if options.get("max_depth"):
                    params["crawlerOptions"]["maxDepth"] = options.get("max_depth")
            job_id = firecrawl_app.crawl_url(url, params)
            website_crawl_time_cache_key = f"website_crawl_{job_id}"
            time = str(datetime.datetime.now().timestamp())
            redis_client.setex(website_crawl_time_cache_key, 3600, time)
            return {"status": "active", "job_id": job_id}
        elif provider == "jinareader":
            api_key = encrypter.decrypt_token(
                tenant_id=current_user.current_tenant_id, token=credentials.get("config").get("api_key")
            )
            crawl_sub_pages = options.get("crawl_sub_pages", False)
            if not crawl_sub_pages:
                response = requests.get(
                    f"https://r.jina.ai/{url}",
                    headers={"Accept": "application/json", "Authorization": f"Bearer {api_key}"},
                )
                if response.json().get("code") != 200:
                    raise ValueError("Failed to crawl")
                return {"status": "active", "data": response.json().get("data")}
            else:
                response = requests.post(
                    "https://adaptivecrawl-kir3wx7b3a-uc.a.run.app",
                    json={
                        "url": url,
                        "maxPages": options.get("limit", 1),
                        "useSitemap": options.get("use_sitemap", True),
                    },
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {api_key}",
                    },
                )
                if response.json().get("code") != 200:
                    raise ValueError("Failed to crawl")
                return {"status": "active", "job_id": response.json().get("data", {}).get("taskId")}
        else:
            raise ValueError("Invalid provider")

    @classmethod
    def get_crawl_status(cls, job_id: str, provider: str) -> dict:
        credentials = ApiKeyAuthService.get_auth_credentials(current_user.current_tenant_id, "website", provider)
        if provider == "firecrawl":
            # decrypt api_key
            api_key = encrypter.decrypt_token(
                tenant_id=current_user.current_tenant_id, token=credentials.get("config").get("api_key")
            )
            firecrawl_app = FirecrawlApp(api_key=api_key, base_url=credentials.get("config").get("base_url", None))
            result = firecrawl_app.check_crawl_status(job_id)
            crawl_status_data = {
                "status": result.get("status", "active"),
                "job_id": job_id,
                "total": result.get("total", 0),
                "current": result.get("current", 0),
                "data": result.get("data", []),
            }
            if crawl_status_data["status"] == "completed":
                website_crawl_time_cache_key = f"website_crawl_{job_id}"
                start_time = redis_client.get(website_crawl_time_cache_key)
                if start_time:
                    end_time = datetime.datetime.now().timestamp()
                    time_consuming = abs(end_time - float(start_time))
                    crawl_status_data["time_consuming"] = f"{time_consuming:.2f}"
                    redis_client.delete(website_crawl_time_cache_key)
        elif provider == "jinareader":
            api_key = encrypter.decrypt_token(
                tenant_id=current_user.current_tenant_id, token=credentials.get("config").get("api_key")
            )
            response = requests.post(
                "https://adaptivecrawlstatus-kir3wx7b3a-uc.a.run.app",
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                json={"taskId": job_id},
            )
            data = response.json().get("data", {})
            crawl_status_data = {
                "status": data.get("status", "active"),
                "job_id": job_id,
                "total": len(data.get("urls", [])),
                "current": len(data.get("processed", [])) + len(data.get("failed", [])),
                "data": [],
                "time_consuming": data.get("duration", 0) / 1000,
            }

            if crawl_status_data["status"] == "completed":
                response = requests.post(
                    "https://adaptivecrawlstatus-kir3wx7b3a-uc.a.run.app",
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                    json={"taskId": job_id, "urls": list(data.get("processed", {}).keys())},
                )
                data = response.json().get("data", {})
                formatted_data = [
                    {
                        "title": item.get("data", {}).get("title"),
                        "source_url": item.get("data", {}).get("url"),
                        "description": item.get("data", {}).get("description"),
                        "markdown": item.get("data", {}).get("content"),
                    }
                    for item in data.get("processed", {}).values()
                ]
                crawl_status_data["data"] = formatted_data
        else:
            raise ValueError("Invalid provider")
        return crawl_status_data

    @classmethod
    def get_crawl_url_data(cls, job_id: str, provider: str, url: str, tenant_id: str) -> dict[Any, Any] | None:
        credentials = ApiKeyAuthService.get_auth_credentials(tenant_id, "website", provider)
        # decrypt api_key
        api_key = encrypter.decrypt_token(tenant_id=tenant_id, token=credentials.get("config").get("api_key"))
        # FIXME data is redefine too many times here, use Any to ease the type checking, fix it later
        data: Any
        if provider == "firecrawl":
            file_key = "website_files/" + job_id + ".txt"
            if storage.exists(file_key):
                d = storage.load_once(file_key)
                if d:
                    data = json.loads(d.decode("utf-8"))
            else:
                firecrawl_app = FirecrawlApp(api_key=api_key, base_url=credentials.get("config").get("base_url", None))
                result = firecrawl_app.check_crawl_status(job_id)
                if result.get("status") != "completed":
                    raise ValueError("Crawl job is not completed")
                data = result.get("data")
            if data:
                for item in data:
                    if item.get("source_url") == url:
                        return dict(item)
            return None
        elif provider == "jinareader":
            if not job_id:
                response = requests.get(
                    f"https://r.jina.ai/{url}",
                    headers={"Accept": "application/json", "Authorization": f"Bearer {api_key}"},
                )
                if response.json().get("code") != 200:
                    raise ValueError("Failed to crawl")
                return dict(response.json().get("data", {}))
            else:
                api_key = encrypter.decrypt_token(tenant_id=tenant_id, token=credentials.get("config").get("api_key"))
                response = requests.post(
                    "https://adaptivecrawlstatus-kir3wx7b3a-uc.a.run.app",
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                    json={"taskId": job_id},
                )
                data = response.json().get("data", {})
                if data.get("status") != "completed":
                    raise ValueError("Crawl job is not completed")

                response = requests.post(
                    "https://adaptivecrawlstatus-kir3wx7b3a-uc.a.run.app",
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
                    json={"taskId": job_id, "urls": list(data.get("processed", {}).keys())},
                )
                data = response.json().get("data", {})
                for item in data.get("processed", {}).values():
                    if item.get("data", {}).get("url") == url:
                        return dict(item.get("data", {}))
            return None
        else:
            raise ValueError("Invalid provider")

    @classmethod
    def get_scrape_url_data(cls, provider: str, url: str, tenant_id: str, only_main_content: bool) -> dict:
        credentials = ApiKeyAuthService.get_auth_credentials(tenant_id, "website", provider)
        if provider == "firecrawl":
            # decrypt api_key
            api_key = encrypter.decrypt_token(tenant_id=tenant_id, token=credentials.get("config").get("api_key"))
            firecrawl_app = FirecrawlApp(api_key=api_key, base_url=credentials.get("config").get("base_url", None))
            params = {"pageOptions": {"onlyMainContent": only_main_content, "includeHtml": False}}
            result = firecrawl_app.scrape_url(url, params)
            return result
        else:
            raise ValueError("Invalid provider")
