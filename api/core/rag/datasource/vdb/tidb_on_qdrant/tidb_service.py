import time
import uuid

import requests
from requests.auth import HTTPDigestAuth

from configs import dify_config
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import TidbAuthBinding


class TidbService:
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
        :param display_name: The user-friendly display name of the cluster (required).
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

        response = requests.post(f"{api_url}/clusters", json=cluster_data, auth=HTTPDigestAuth(public_key, private_key))

        if response.status_code == 200:
            response_data = response.json()
            cluster_id = response_data["clusterId"]
            retry_count = 0
            max_retries = 30
            while retry_count < max_retries:
                cluster_response = TidbService.get_tidb_serverless_cluster(api_url, public_key, private_key, cluster_id)
                if cluster_response["state"] == "ACTIVE":
                    user_prefix = cluster_response["userPrefix"]
                    return {
                        "cluster_id": cluster_id,
                        "cluster_name": display_name,
                        "account": f"{user_prefix}.root",
                        "password": password,
                    }
                time.sleep(30)  # wait 30 seconds before retrying
                retry_count += 1
        else:
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

        response = requests.delete(f"{api_url}/clusters/{cluster_id}", auth=HTTPDigestAuth(public_key, private_key))

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

        response = requests.get(f"{api_url}/clusters/{cluster_id}", auth=HTTPDigestAuth(public_key, private_key))

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

        response = requests.patch(
            f"{api_url}/clusters/{cluster_id}/sqlUsers/{account}",
            json=body,
            auth=HTTPDigestAuth(public_key, private_key),
        )

        if response.status_code == 200:
            return response.json()
        else:
            response.raise_for_status()

    @staticmethod
    def batch_update_tidb_serverless_cluster_status(
        tidb_serverless_list: list[TidbAuthBinding],
        project_id: str,
        api_url: str,
        iam_url: str,
        public_key: str,
        private_key: str,
    ):
        """
        Update the status of a new TiDB Serverless cluster.
        :param project_id: The project ID of the TiDB Cloud project (required).
        :param api_url: The URL of the TiDB Cloud API (required).
        :param iam_url: The URL of the TiDB Cloud IAM API (required).
        :param public_key: The public key for the API (required).
        :param private_key: The private key for the API (required).
        :param display_name: The user-friendly display name of the cluster (required).
        :param region: The region where the cluster will be created (required).

        :return: The response from the API.
        """
        tidb_serverless_list_map = {item.cluster_id: item for item in tidb_serverless_list}
        cluster_ids = [item.cluster_id for item in tidb_serverless_list]
        params = {"clusterIds": cluster_ids, "view": "BASIC"}
        response = requests.get(
            f"{api_url}/clusters:batchGet", params=params, auth=HTTPDigestAuth(public_key, private_key)
        )

        if response.status_code == 200:
            response_data = response.json()
            for item in response_data["clusters"]:
                state = item["state"]
                userPrefix = item["userPrefix"]
                if state == "ACTIVE" and len(userPrefix) > 0:
                    cluster_info = tidb_serverless_list_map[item["clusterId"]]
                    cluster_info.status = "ACTIVE"
                    cluster_info.account = f"{userPrefix}.root"
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
        :param project_id: The project ID of the TiDB Cloud project (required).
        :param api_url: The URL of the TiDB Cloud API (required).
        :param iam_url: The URL of the TiDB Cloud IAM API (required).
        :param public_key: The public key for the API (required).
        :param private_key: The private key for the API (required).
        :param display_name: The user-friendly display name of the cluster (required).
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
        response = requests.post(
            f"{api_url}/clusters:batchCreate", json=request_body, auth=HTTPDigestAuth(public_key, private_key)
        )

        if response.status_code == 200:
            response_data = response.json()
            cluster_infos = []
            for item in response_data["clusters"]:
                cache_key = f"tidb_serverless_cluster_password:{item['displayName']}"
                cached_password = redis_client.get(cache_key)
                if not cached_password:
                    continue
                cluster_info = {
                    "cluster_id": item["clusterId"],
                    "cluster_name": item["displayName"],
                    "account": "root",
                    "password": cached_password.decode("utf-8"),
                }
                cluster_infos.append(cluster_info)
            return cluster_infos
        else:
            response.raise_for_status()
            return []  # FIXME for mypy, This line will not be reached as raise_for_status() will raise an exception
