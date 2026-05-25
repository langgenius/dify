import logging
import time
import uuid
from collections.abc import Sequence

import httpx
from httpx import DigestAuth

from configs import dify_config
from core.helper.http_client_pooling import get_pooled_http_client
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import TidbAuthBinding
from models.enums import TidbAuthBindingStatus

logger = logging.getLogger(__name__)

# Reuse a pooled HTTP client for all TiDB Cloud requests to minimize connection churn
_tidb_http_client: httpx.Client = get_pooled_http_client(
    "tidb:cloud",
    lambda: httpx.Client(limits=httpx.Limits(max_keepalive_connections=50, max_connections=100)),
)


class TidbService:
    @staticmethod
    def extract_qdrant_endpoint(cluster_response: dict) -> str | None:
        """Extract the qdrant endpoint URL from a Get Cluster API response.

        Reads ``endpoints.public.host`` (e.g. ``gateway01.xx.tidbcloud.com``),
        prepends ``qdrant-`` and wraps it as an ``https://`` URL.
        """
        endpoints = cluster_response.get("endpoints") or {}
        public = endpoints.get("public") or {}
        host = public.get("host")
        if host:
            return f"https://qdrant-{host}"
        return None

    @staticmethod
    def fetch_qdrant_endpoint(api_url: str, public_key: str, private_key: str, cluster_id: str) -> str | None:
        """Call Get Cluster API and extract the qdrant endpoint.

        Use ``extract_qdrant_endpoint`` instead when you already have
        the cluster response to avoid a redundant API call.
        """
        try:
            logger.info("Fetching qdrant endpoint for cluster %s", cluster_id)
            cluster_response = TidbService.get_tidb_serverless_cluster(api_url, public_key, private_key, cluster_id)
            if not cluster_response:
                logger.warning("Empty response from Get Cluster API for cluster %s", cluster_id)
                return None
            qdrant_url = TidbService.extract_qdrant_endpoint(cluster_response)
            if qdrant_url:
                logger.info("Resolved qdrant endpoint for cluster %s: %s", cluster_id, qdrant_url)
                return qdrant_url
            logger.warning(
                "No endpoints.public.host found for cluster %s, response keys: %s",
                cluster_id,
                list(cluster_response.keys()),
            )
        except Exception:
            logger.exception("Failed to fetch qdrant endpoint for cluster %s", cluster_id)
        return None

    @staticmethod
    def create_tidb_serverless_cluster(
        project_id: str, api_url: str, iam_url: str, public_key: str, private_key: str, region: str
    ):
        """
        Creates a new TiDB Serverless cluster.
        :param project_id: The project ID of the TiDB Cloud project (required).
        :param api_url: The URL of the TiDB Cloud API (required).
        :param iam_url: The URL of the TiDB Cloud IAM API (required).
        :param public_key: The public key for the API (required).
        :param private_key: The private key for the API (required).
        :param region: The region where the cluster will be created (required).

        :return: The response from the API.
        """

        region_object = {
            "name": region,
        }

        labels = {
            "tidb.cloud/project": project_id,
        }

        spending_limit = {
            "monthly": dify_config.TIDB_SPEND_LIMIT,
        }
        password = str(uuid.uuid4()).replace("-", "")[:16]
        display_name = str(uuid.uuid4()).replace("-", "")[:16]
        cluster_data = {
            "displayName": display_name,
            "region": region_object,
            "labels": labels,
            "spendingLimit": spending_limit,
            "rootPassword": password,
        }

        logger.info("Creating TiDB serverless cluster: display_name=%s, region=%s", display_name, region)
        response = _tidb_http_client.post(
            f"{api_url}/clusters", json=cluster_data, auth=DigestAuth(public_key, private_key)
        )

        if response.status_code == 200:
            response_data = response.json()
            cluster_id = response_data["clusterId"]
            logger.info("Cluster created, cluster_id=%s, waiting for ACTIVE state", cluster_id)
            retry_count = 0
            max_retries = 30
            while retry_count < max_retries:
                cluster_response = TidbService.get_tidb_serverless_cluster(api_url, public_key, private_key, cluster_id)
                if cluster_response["state"] == "ACTIVE":
                    user_prefix = cluster_response["userPrefix"]
                    qdrant_endpoint = TidbService.extract_qdrant_endpoint(cluster_response)
                    logger.info(
                        "Cluster %s is ACTIVE, user_prefix=%s, qdrant_endpoint=%s",
                        cluster_id,
                        user_prefix,
                        qdrant_endpoint,
                    )
                    return {
                        "cluster_id": cluster_id,
                        "cluster_name": display_name,
                        "account": f"{user_prefix}.root",
                        "password": password,
                        "qdrant_endpoint": qdrant_endpoint,
                    }
                logger.info(
                    "Cluster %s state=%s, retry %d/%d",
                    cluster_id,
                    cluster_response["state"],
                    retry_count + 1,
                    max_retries,
                )
                time.sleep(30)
                retry_count += 1
            logger.error("Cluster %s did not become ACTIVE after %d retries", cluster_id, max_retries)
        else:
            logger.error("Failed to create cluster: status=%d, body=%s", response.status_code, response.text)
            response.raise_for_status()

    @staticmethod
    def delete_tidb_serverless_cluster(api_url: str, public_key: str, private_key: str, cluster_id: str):
        """
        Deletes a specific TiDB Serverless cluster.

        :param api_url: The URL of the TiDB Cloud API (required).
        :param public_key: The public key for the API (required).
        :param private_key: The private key for the API (required).
        :param cluster_id: The ID of the cluster to be deleted (required).
        :return: The response from the API.
        """

        response = _tidb_http_client.delete(
            f"{api_url}/clusters/{cluster_id}", auth=DigestAuth(public_key, private_key)
        )

        if response.status_code == 200:
            return response.json()
        else:
            response.raise_for_status()

    @staticmethod
    def get_tidb_serverless_cluster(api_url: str, public_key: str, private_key: str, cluster_id: str):
        """
        Deletes a specific TiDB Serverless cluster.

        :param api_url: The URL of the TiDB Cloud API (required).
        :param public_key: The public key for the API (required).
        :param private_key: The private key for the API (required).
        :param cluster_id: The ID of the cluster to be deleted (required).
        :return: The response from the API.
        """

        response = _tidb_http_client.get(f"{api_url}/clusters/{cluster_id}", auth=DigestAuth(public_key, private_key))

        if response.status_code == 200:
            return response.json()
        else:
            response.raise_for_status()

    @staticmethod
    def change_tidb_serverless_root_password(
        api_url: str, public_key: str, private_key: str, cluster_id: str, account: str, new_password: str
    ):
        """
        Changes the root password of a specific TiDB Serverless cluster.

        :param api_url: The URL of the TiDB Cloud API (required).
        :param public_key: The public key for the API (required).
        :param private_key: The private key for the API (required).
        :param cluster_id: The ID of the cluster for which the password is to be changed (required).+
        :param account: The account for which the password is to be changed (required).
        :param new_password: The new password for the root user (required).
        :return: The response from the API.
        """

        body = {"password": new_password, "builtinRole": "role_admin", "customRoles": []}

        response = _tidb_http_client.patch(
            f"{api_url}/clusters/{cluster_id}/sqlUsers/{account}",
            json=body,
            auth=DigestAuth(public_key, private_key),
        )

        if response.status_code == 200:
            return response.json()
        else:
            response.raise_for_status()

    @staticmethod
    def batch_update_tidb_serverless_cluster_status(
        tidb_serverless_list: Sequence[TidbAuthBinding],
        project_id: str,
        api_url: str,
        iam_url: str,
        public_key: str,
        private_key: str,
    ):
        """
        Update the status of a new TiDB Serverless cluster.
        :param tidb_serverless_list: The TiDB serverless list (required).
        :param project_id: The project ID of the TiDB Cloud project (required).
        :param api_url: The URL of the TiDB Cloud API (required).
        :param iam_url: The URL of the TiDB Cloud IAM API (required).
        :param public_key: The public key for the API (required).
        :param private_key: The private key for the API (required).

        :return: The response from the API.
        """
        tidb_serverless_list_map = {item.cluster_id: item for item in tidb_serverless_list}
        cluster_ids = [item.cluster_id for item in tidb_serverless_list]
        params = {"clusterIds": cluster_ids, "view": "BASIC"}
        response = _tidb_http_client.get(
            f"{api_url}/clusters:batchGet", params=params, auth=DigestAuth(public_key, private_key)
        )

        if response.status_code == 200:
            response_data = response.json()
            for item in response_data["clusters"]:
                state = item["state"]
                userPrefix = item["userPrefix"]
                if state == "ACTIVE" and len(userPrefix) > 0:
                    cluster_info = tidb_serverless_list_map[item["clusterId"]]
                    cluster_info.account = f"{userPrefix}.root"
                    if not cluster_info.qdrant_endpoint:
                        cluster_info.qdrant_endpoint = TidbService.extract_qdrant_endpoint(
                            item
                        ) or TidbService.fetch_qdrant_endpoint(api_url, public_key, private_key, item["clusterId"])
                    if cluster_info.qdrant_endpoint:
                        cluster_info.status = TidbAuthBindingStatus.ACTIVE
                    else:
                        logger.warning(
                            "Cluster %s is ACTIVE but qdrant endpoint is not ready; will retry later",
                            item["clusterId"],
                        )
                    db.session.add(cluster_info)
            db.session.commit()
        else:
            response.raise_for_status()

    @staticmethod
    def batch_create_tidb_serverless_cluster(
        batch_size: int, project_id: str, api_url: str, iam_url: str, public_key: str, private_key: str, region: str
    ) -> list[dict]:
        """
        Creates a new TiDB Serverless cluster.
        :param batch_size: The batch size (required).
        :param project_id: The project ID of the TiDB Cloud project (required).
        :param api_url: The URL of the TiDB Cloud API (required).
        :param iam_url: The URL of the TiDB Cloud IAM API (required).
        :param public_key: The public key for the API (required).
        :param private_key: The private key for the API (required).
        :param region: The region where the cluster will be created (required).

        :return: The response from the API.
        """
        clusters = []
        for _ in range(batch_size):
            region_object = {
                "name": region,
            }

            labels = {
                "tidb.cloud/project": project_id,
            }

            spending_limit = {
                "monthly": dify_config.TIDB_SPEND_LIMIT,
            }
            password = str(uuid.uuid4()).replace("-", "")[:16]
            display_name = str(uuid.uuid4()).replace("-", "")
            cluster_data = {
                "cluster": {
                    "displayName": display_name,
                    "region": region_object,
                    "labels": labels,
                    "spendingLimit": spending_limit,
                    "rootPassword": password,
                }
            }
            cache_key = f"tidb_serverless_cluster_password:{display_name}"
            redis_client.setex(cache_key, 3600, password)
            clusters.append(cluster_data)

        request_body = {"requests": clusters}
        response = _tidb_http_client.post(
            f"{api_url}/clusters:batchCreate", json=request_body, auth=DigestAuth(public_key, private_key)
        )

        if response.status_code == 200:
            response_data = response.json()
            cluster_infos = []
            logger.info("Batch created %d clusters", len(response_data.get("clusters", [])))
            for item in response_data["clusters"]:
                cache_key = f"tidb_serverless_cluster_password:{item['displayName']}"
                cached_password = redis_client.get(cache_key)
                if not cached_password:
                    logger.warning("No cached password for cluster %s, skipping", item["displayName"])
                    continue
                qdrant_endpoint = TidbService.fetch_qdrant_endpoint(api_url, public_key, private_key, item["clusterId"])
                logger.info(
                    "Batch cluster %s: qdrant_endpoint=%s",
                    item["clusterId"],
                    qdrant_endpoint,
                )
                cluster_info = {
                    "cluster_id": item["clusterId"],
                    "cluster_name": item["displayName"],
                    "account": "root",
                    "password": cached_password.decode("utf-8"),
                    "qdrant_endpoint": qdrant_endpoint,
                }
                cluster_infos.append(cluster_info)
            return cluster_infos
        else:
            logger.error("Batch create failed: status=%d, body=%s", response.status_code, response.text)
            response.raise_for_status()
            return []
