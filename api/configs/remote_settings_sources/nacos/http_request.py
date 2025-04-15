import requests

def http_request(url, method='GET', headers=None, data=None):
    try:
        response = requests.request(method, url, headers=headers, data=data)
        response.raise_for_status()  # 如果响应状态码不是200，抛出异常
        return response.text
    except requests.exceptions.RequestException as e:
        return f"请求失败: {e}"