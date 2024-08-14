import requests
from requests.auth import HTTPDigestAuth


class TidbService:

    @staticmethod
    def create_tidb_serverless_cluster(tidb_config: TidbConfig, display_name: str, region: str):
        """
        Creates a new TiDB Serverless cluster.
        :param tidb_config: The configuration for the TiDB Cloud API.
        :param display_name: The user-friendly display name of the cluster (required).
        :param region: The region where the cluster will be created (required).

        :return: The response from the API.
        """

        cluster_data = {
            "displayName": display_name,
            "region": region,
        }

        response = requests.post(f"{tidb_config.api_url}/clusters", json={"cluster": cluster_data},
                                 auth=HTTPDigestAuth(tidb_config.public_key, tidb_config.private_key))

        if response.status_code == 200:
            return response.json()
        else:
            response.raise_for_status()

    @staticmethod
    def delete_tidb_serverless_cluster(tidb_config: TidbConfig, cluster_id: str):
        """
        Deletes a specific TiDB Serverless cluster.

        :param tidb_config: The configuration for the TiDB Cloud API.
        :param cluster_id: The ID of the cluster to be deleted (required).
        :return: The response from the API.
        """

        response = requests.delete(f"{tidb_config.api_url}/clusters/{cluster_id}",
                                   auth=HTTPDigestAuth(tidb_config.public_key, tidb_config.private_key))

        if response.status_code == 200:
            return response.json()
        else:
            response.raise_for_status()

    @staticmethod
    def change_tidb_serverless_root_password(tidb_config: TidbConfig, cluster_id: str, new_password: str):
        """
        Changes the root password of a specific TiDB Serverless cluster.

        :param tidb_config: The configuration for the TiDB Cloud API.
        :param cluster_id: The ID of the cluster for which the password is to be changed (required).
        :param new_password: The new password for the root user (required).
        :return: The response from the API.
        """

        body = {
            "password": new_password
        }

        response = requests.put(f"{tidb_config.api_url}/clusters/{cluster_id}/password", json=body,
                                auth=HTTPDigestAuth(tidb_config.public_key, tidb_config.private_key))

        if response.status_code == 200:
            return response.json()
        else:
            response.raise_for_status()
