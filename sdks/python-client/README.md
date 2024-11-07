# dify-oapi

A Dify App Service-API Client, using for build a webapp by request Service-API

## Usage

First, install `dify-oapi` python sdk package:

```
pip install dify-oapi
```

Write your code with sdk:

- chat generate with `blocking` response_mode

```python
from dify_oapi.api.chat.v1.model.chat_request import ChatRequest
from dify_oapi.api.chat.v1.model.chat_request_body import ChatRequestBody
from dify_oapi.api.chat.v1.model.chat_request_file import ChatRequestFile
from dify_oapi.client import Client
from dify_oapi.core.model.request_option import RequestOption

def main():
    client = Client.builder().domain("https://api.dify.ai").build()
    req_file = (
        ChatRequestFile.builder()
        .type("image")
        .transfer_method("remote_url")
        .url("https://cloud.dify.ai/logo/logo-site.png")
        .build()
    )
    req_body = (
        ChatRequestBody.builder()
        .inputs({})
        .query("What are the specs of the iPhone 13 Pro Max?")
        .response_mode("blocking")
        .conversation_id("")
        .user("abc-123")
        .files([req_file])
        .build()
    )
    req = ChatRequest.builder().request_body(req_body).build()
    req_option = RequestOption.builder().api_key("<your-api-key>").build()
    response = client.chat.v1.chat.chat(req, req_option, False)
    # response = await client.chat.v1.chat.achat(req, req_option, False)
    print(response.success)
    print(response.code)
    print(response.msg)
    print(response.answer)


if __name__ == "__main__":
    main()

```

- chat generate with `streaming` response_mode

```python
from dify_oapi.api.chat.v1.model.chat_request import ChatRequest
from dify_oapi.api.chat.v1.model.chat_request_body import ChatRequestBody
from dify_oapi.api.chat.v1.model.chat_request_file import ChatRequestFile
from dify_oapi.client import Client
from dify_oapi.core.model.request_option import RequestOption

def main():
    client = Client.builder().domain("https://api.dify.ai").build()
    req_file = (
        ChatRequestFile.builder()
        .type("image")
        .transfer_method("remote_url")
        .url("https://cloud.dify.ai/logo/logo-site.png")
        .build()
    )
    req_body = (
        ChatRequestBody.builder()
        .inputs({})
        .query("What are the specs of the iPhone 13 Pro Max?")
        .response_mode("streaming")
        .conversation_id("")
        .user("abc-123")
        .files([req_file])
        .build()
    )
    req = ChatRequest.builder().request_body(req_body).build()
    req_option = RequestOption.builder().api_key("<your-api-key>").build()
    response = client.chat.v1.chat.chat(req, req_option, True)
    # response = await client.chat.v1.chat.achat(req, req_option, True)
    for chunk in response:
        print(chunk)


if __name__ == "__main__":
    main()
```
