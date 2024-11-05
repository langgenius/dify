from core.model_runtime.model_providers.huggingface_tei.tei_helper import TeiModelExtraParameter


class MockTEIClass:
    @staticmethod
    def get_tei_extra_parameter(server_url: str, model_name: str) -> TeiModelExtraParameter:
        # During mock, we don't have a real server to query, so we just return a dummy value
        if "rerank" in model_name:
            model_type = "reranker"
        else:
            model_type = "embedding"

        return TeiModelExtraParameter(model_type=model_type, max_input_length=512, max_client_batch_size=1)

    @staticmethod
    def invoke_tokenize(server_url: str, texts: list[str]) -> list[list[dict]]:
        # Use space as token separator, and split the text into tokens
        tokenized_texts = []
        for text in texts:
            tokens = text.split(" ")
            current_index = 0
            tokenized_text = []
            for idx, token in enumerate(tokens):
                s_token = {
                    "id": idx,
                    "text": token,
                    "special": False,
                    "start": current_index,
                    "stop": current_index + len(token),
                }
                current_index += len(token) + 1
                tokenized_text.append(s_token)
            tokenized_texts.append(tokenized_text)
        return tokenized_texts

    @staticmethod
    def invoke_embeddings(server_url: str, texts: list[str]) -> dict:
        # {
        #     "object": "list",
        #     "data": [
        #         {
        #             "object": "embedding",
        #             "embedding": [...],
        #             "index": 0
        #         }
        #     ],
        #     "model": "MODEL_NAME",
        #     "usage": {
        #         "prompt_tokens": 3,
        #         "total_tokens": 3
        #     }
        # }
        embeddings = []
        for idx in range(len(texts)):
            embedding = [0.1] * 768
            embeddings.append(
                {
                    "object": "embedding",
                    "embedding": embedding,
                    "index": idx,
                }
            )
        return {
            "object": "list",
            "data": embeddings,
            "model": "MODEL_NAME",
            "usage": {
                "prompt_tokens": sum(len(text.split(" ")) for text in texts),
                "total_tokens": sum(len(text.split(" ")) for text in texts),
            },
        }

    @staticmethod
    def invoke_rerank(server_url: str, query: str, texts: list[str]) -> list[dict]:
        #         Example response:
        # [
        #     {
        #         "index": 0,
        #         "text": "Deep Learning is ...",
        #         "score": 0.9950755
        #     }
        # ]
        reranked_docs = []
        for idx, text in enumerate(texts):
            reranked_docs.append(
                {
                    "index": idx,
                    "text": text,
                    "score": 0.9,
                }
            )
            # For mock, only return the first document
            break
        return reranked_docs
