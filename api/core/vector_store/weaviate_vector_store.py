from langchain.vectorstores import Weaviate


class WeaviateVectorStore(Weaviate):
    def del_texts(self, where_filter: dict):
        if not where_filter:
            raise ValueError('where_filter must not be empty')

        self._client.batch.delete_objects(
            class_name=self._index_name,
            where=where_filter,
            output='minimal'
        )

    def del_text(self, uuid: str) -> None:
        self._client.data_object.delete(
            uuid,
            class_name=self._index_name
        )

    def text_exists(self, uuid: str) -> bool:
        result = self._client.query.get(self._index_name).with_additional(["id"]).with_where({
            "path": ["doc_id"],
            "operator": "Equal",
            "valueText": uuid,
        }).with_limit(1).do()

        if "errors" in result:
            raise ValueError(f"Error during query: {result['errors']}")

        entries = result["data"]["Get"][self._index_name]
        if len(entries) == 0:
            return False

        return True

    def delete(self):
        self._client.schema.delete_class(self._index_name)
