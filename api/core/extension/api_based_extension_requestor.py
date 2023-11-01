import requests

from models.api_based_extension import APIBasedExtensionPoint


class APIBasedExtensionRequestor:
    timeout: (int, int) = (5, 60)
    """timeout for request connect and read"""

    def __init__(self, api_endpoint: str, api_key: str) -> None:
        self.api_endpoint = api_endpoint
        self.api_key = api_key

    def request(self, point: APIBasedExtensionPoint, params: dict) -> dict:
        """
        Request the api.

        :param point: the api point
        :param params: the request params
        :return: the response json
        """
        headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer {}".format(self.api_key)
        }

        url = self.api_endpoint

        try:
            response = requests.request(
                method='POST',
                url=url,
                json={
                    'point': point.value,
                    'params': params
                },
                headers=headers,
                timeout=self.timeout
            )

            # TODO proxy support for security
        except requests.exceptions.Timeout:
            raise ValueError("request timeout")
        except requests.exceptions.ConnectionError:
            raise ValueError("request connection error")

        if response.status_code != 200:
            raise ValueError("request error, status_code: {}, content: {}".format(response.status_code, response.content))

        return response.json()
