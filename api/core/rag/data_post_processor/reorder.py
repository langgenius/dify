from core.rag.models.document import Document


class ReorderRunner:

    def run(self, documents: list[Document]) -> list[Document]:
        # Retrieve elements from odd indices (0, 2, 4, etc.) of the documents list
        odd_elements = documents[::2]

        # Retrieve elements from even indices (1, 3, 5, etc.) of the documents list
        even_elements = documents[1::2]

        # Reverse the list of elements from even indices
        even_elements_reversed = even_elements[::-1]

        new_documents = odd_elements + even_elements_reversed

        return new_documents
