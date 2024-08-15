import time
import uuid

import requests
from requests.auth import HTTPDigestAuth


class TidbService:

    @staticmethod
    def create_tidb_serverless_cluster(project_id: str,
                                       api_url: str,
                                       iam_url: str,
                                       public_key: str,
                                       private_key: str,
                                       display_name: str,
                                       region: str):
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
            "monthly": 100,
        }
        cluster_data = {
            "displayName": display_name,
            "region": region_object,
            "labels": labels,
            "spendingLimit": spending_limit,
        }

        response = requests.post(f"{api_url}/clusters", json=cluster_data,
                                 auth=HTTPDigestAuth(public_key, private_key))

        if response.status_code == 200:
            response_data = response.json()
            cluster_id = response_data["clusterId"]
            retry_count = 0
            max_retries = 50
            while retry_count < max_retries:
                cluster_response = TidbService.get_tidb_serverless_cluster(api_url, public_key, private_key, cluster_id)
                if cluster_response["state"] == "ACTIVE":
                    user_prefix = cluster_response["userPrefix"]
                    password = str(uuid.uuid4()).replace("-", "")[:16]
                    TidbService.change_tidb_serverless_root_password(iam_url, public_key, private_key,
                                                                     cluster_id, f'{user_prefix}.root', password)
                    return {
                        "cluster_id": cluster_id,
                        "cluster_name": display_name,
                        "account": f'{user_prefix}.root',
                        "password": password
                    }
                time.sleep(3)  # wait 3 seconds before retrying
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

        response = requests.delete(f"{api_url}/clusters/{cluster_id}",
                                   auth=HTTPDigestAuth(public_key, private_key))

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

        response = requests.get(f"{api_url}/clusters/{cluster_id}",
                                auth=HTTPDigestAuth(public_key, private_key))

        if response.status_code == 200:
            return response.json()
        else:
            response.raise_for_status()

    @staticmethod
    def change_tidb_serverless_root_password(api_url: str, public_key: str, private_key: str, cluster_id: str,
                                             account: str, new_password: str):
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

        body = {
            "password": new_password,
            "builtinRole": "role_admin",
            "customRoles": []
        }

        response = requests.patch(f"{api_url}/clusters/{cluster_id}/sqlUsers/{account}", json=body,
                                  auth=HTTPDigestAuth(public_key, private_key))

        if response.status_code == 200:
            return response.json()
        else:
            response.raise_for_status()
