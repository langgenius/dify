import os
import re
from typing import List, Union

import pytest
from _pytest.monkeypatch import MonkeyPatch
from requests import Response
from requests.exceptions import ConnectionError
from requests.sessions import Session
from xinference_client.client.restful.restful_client import (Client, RESTfulChatglmCppChatModelHandle,
                                                             RESTfulChatModelHandle, RESTfulEmbeddingModelHandle,
                                                             RESTfulGenerateModelHandle, RESTfulRerankModelHandle)
from xinference_client.types import Embedding, EmbeddingData, EmbeddingUsage


class MockXinferenceClass(object):
    def get_chat_model(self: Client, model_uid: str) -> Union[RESTfulChatglmCppChatModelHandle, RESTfulGenerateModelHandle, RESTfulChatModelHandle]:
        if not re.match(r'https?:\/\/[^\s\/$.?#].[^\s]*$', self.base_url):
            raise RuntimeError('404 Not Found')
        
        if 'generate' == model_uid:
            return RESTfulGenerateModelHandle(model_uid, base_url=self.base_url, auth_headers={})
        if 'chat' == model_uid:
            return RESTfulChatModelHandle(model_uid, base_url=self.base_url, auth_headers={})
        if 'embedding' == model_uid:
            return RESTfulEmbeddingModelHandle(model_uid, base_url=self.base_url, auth_headers={})
        if 'rerank' == model_uid:
            return RESTfulRerankModelHandle(model_uid, base_url=self.base_url, auth_headers={})
        raise RuntimeError('404 Not Found')
        
    def get(self: Session, url: str, **kwargs):
        response = Response()
        if 'v1/models/' in url:
            # get model uid
            model_uid = url.split('/')[-1] or ''
            if not re.match(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', model_uid) and \
                model_uid not in ['generate', 'chat', 'embedding', 'rerank']:
                response.status_code = 404
                response._content = b'{}'
                return response

            # check if url is valid
            if not re.match(r'^(https?):\/\/[^\s\/$.?#].[^\s]*$', url):
                response.status_code = 404
                response._content = b'{}'
                return response
            
            if model_uid in ['generate', 'chat']:
                response.status_code = 200
                response._content = b'''{
                    "model_type": "LLM",
                    "address": "127.0.0.1:43877",
                    "accelerators": [
                        "0",
                        "1"
                    ],
                    "model_name": "chatglm3-6b",
                    "model_lang": [
                        "en"
                    ],
                    "model_ability": [
                        "generate",
                        "chat"
                    ],
                    "model_description": "latest chatglm3",
                    "model_format": "pytorch",
                    "model_size_in_billions": 7,
                    "quantization": "none",
                    "model_hub": "huggingface",
                    "revision": null,
                    "context_length": 2048,
                    "replica": 1
                }'''
                return response
            
            elif model_uid == 'embedding':
                response.status_code = 200
                response._content = b'''{
                    "model_type": "embedding",
                    "address": "127.0.0.1:43877",
                    "accelerators": [
                        "0",
                        "1"
                    ],
                    "model_name": "bge",
                    "model_lang": [
                        "en"
                    ],
                    "revision": null,
                    "max_tokens": 512
                }'''
                return response
            
        elif 'v1/cluster/auth' in url:
            response.status_code = 200
            response._content = b'''{
                "auth": true
            }'''
            return response
        
    def _check_cluster_authenticated(self):
        self._cluster_authed = True
        
    def rerank(self: RESTfulRerankModelHandle, documents: List[str], query: str, top_n: int) -> dict:
        # check if self._model_uid is a valid uuid
        if not re.match(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', self._model_uid) and \
            self._model_uid != 'rerank':
            raise RuntimeError('404 Not Found')
        
        if not re.match(r'^(https?):\/\/[^\s\/$.?#].[^\s]*$', self._base_url):
            raise RuntimeError('404 Not Found')

        if top_n is None:
            top_n = 1

        return {
            'results': [
                {
                    'index': i,
                    'document': doc,
                    'relevance_score': 0.9
                }
                for i, doc in enumerate(documents[:top_n])
            ]
        }
        
    def create_embedding(
        self: RESTfulGenerateModelHandle,
        input: Union[str, List[str]],
        **kwargs
    ) -> dict:
        # check if self._model_uid is a valid uuid
        if not re.match(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', self._model_uid) and \
            self._model_uid != 'embedding':
            raise RuntimeError('404 Not Found')

        if isinstance(input, str):
            input = [input]
        ipt_len = len(input)

        embedding = Embedding(
            object="list",
            model=self._model_uid,
            data=[
                EmbeddingData(
                    index=i,
                    object="embedding",
                    embedding=[1919.810 for _ in range(768)]
                )
                for i in range(ipt_len)
            ],
            usage=EmbeddingUsage(
                prompt_tokens=ipt_len,
                total_tokens=ipt_len
            )
        )

        return embedding

MOCK = os.getenv('MOCK_SWITCH', 'false').lower() == 'true'

@pytest.fixture
def setup_xinference_mock(request, monkeypatch: MonkeyPatch):
    if MOCK:
        monkeypatch.setattr(Client, 'get_model', MockXinferenceClass.get_chat_model)
        monkeypatch.setattr(Client, '_check_cluster_authenticated', MockXinferenceClass._check_cluster_authenticated)
        monkeypatch.setattr(Session, 'get', MockXinferenceClass.get)
        monkeypatch.setattr(RESTfulEmbeddingModelHandle, 'create_embedding', MockXinferenceClass.create_embedding)
        monkeypatch.setattr(RESTfulRerankModelHandle, 'rerank', MockXinferenceClass.rerank)
    yield

    if MOCK:
        monkeypatch.undo()