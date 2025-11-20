"""
Advanced usage examples for the Dify Python SDK.

This example demonstrates:
- Error handling and retries
- Logging configuration
- Context managers
- Async usage
- File uploads
- Dataset management
"""

import asyncio
import logging
from pathlib import Path

from dify_client import (
    ChatClient,
    CompletionClient,
    AsyncChatClient,
    KnowledgeBaseClient,
    DifyClient,
)
from dify_client.exceptions import (
    APIError,
    RateLimitError,
    AuthenticationError,
    DifyClientError,
)


def setup_logging():
    """Setup logging for the SDK."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")


def example_chat_with_error_handling():
    """Example of chat with comprehensive error handling."""
    api_key = "your-api-key-here"

    try:
        with ChatClient(api_key, enable_logging=True) as client:
            # Simple chat message
            response = client.create_chat_message(
                inputs={}, query="Hello, how are you?", user="user-123", response_mode="blocking"
            )

            result = response.json()
            print(f"Response: {result.get('answer')}")

    except AuthenticationError as e:
        print(f"Authentication failed: {e}")
        print("Please check your API key")

    except RateLimitError as e:
        print(f"Rate limit exceeded: {e}")
        if e.retry_after:
            print(f"Retry after {e.retry_after} seconds")

    except APIError as e:
        print(f"API error: {e.message}")
        print(f"Status code: {e.status_code}")

    except DifyClientError as e:
        print(f"Dify client error: {e}")

    except Exception as e:
        print(f"Unexpected error: {e}")


def example_completion_with_files():
    """Example of completion with file upload."""
    api_key = "your-api-key-here"

    with CompletionClient(api_key) as client:
        # Upload an image file first
        file_path = "path/to/your/image.jpg"

        try:
            with open(file_path, "rb") as f:
                files = {"file": (Path(file_path).name, f, "image/jpeg")}
                upload_response = client.file_upload("user-123", files)
                upload_response.raise_for_status()

                file_id = upload_response.json().get("id")
                print(f"File uploaded with ID: {file_id}")

                # Use the uploaded file in completion
                files_list = [{"type": "image", "transfer_method": "local_file", "upload_file_id": file_id}]

                completion_response = client.create_completion_message(
                    inputs={"query": "Describe this image"}, response_mode="blocking", user="user-123", files=files_list
                )

                result = completion_response.json()
                print(f"Completion result: {result.get('answer')}")

        except FileNotFoundError:
            print(f"File not found: {file_path}")
        except Exception as e:
            print(f"Error during file upload/completion: {e}")


def example_dataset_management():
    """Example of dataset management operations."""
    api_key = "your-api-key-here"

    with KnowledgeBaseClient(api_key) as kb_client:
        try:
            # Create a new dataset
            create_response = kb_client.create_dataset(name="My Test Dataset")
            create_response.raise_for_status()

            dataset_id = create_response.json().get("id")
            print(f"Created dataset with ID: {dataset_id}")

            # Create a client with the dataset ID
            dataset_client = KnowledgeBaseClient(api_key, dataset_id=dataset_id)

            # Add a document by text
            doc_response = dataset_client.create_document_by_text(
                name="Test Document", text="This is a test document for the knowledge base."
            )
            doc_response.raise_for_status()

            document_id = doc_response.json().get("document", {}).get("id")
            print(f"Created document with ID: {document_id}")

            # List documents
            list_response = dataset_client.list_documents()
            list_response.raise_for_status()

            documents = list_response.json().get("data", [])
            print(f"Dataset contains {len(documents)} documents")

            # Update dataset configuration
            update_response = dataset_client.update_dataset(
                name="Updated Dataset Name", description="Updated description", indexing_technique="high_quality"
            )
            update_response.raise_for_status()

            print("Dataset updated successfully")

        except Exception as e:
            print(f"Dataset management error: {e}")


async def example_async_chat():
    """Example of async chat usage."""
    api_key = "your-api-key-here"

    try:
        async with AsyncChatClient(api_key) as client:
            # Create chat message
            response = await client.create_chat_message(
                inputs={}, query="What's the weather like?", user="user-456", response_mode="blocking"
            )

            result = response.json()
            print(f"Async response: {result.get('answer')}")

            # Get conversations
            conversations = await client.get_conversations("user-456")
            conversations.raise_for_status()

            conv_data = conversations.json()
            print(f"Found {len(conv_data.get('data', []))} conversations")

    except Exception as e:
        print(f"Async chat error: {e}")


def example_streaming_response():
    """Example of handling streaming responses."""
    api_key = "your-api-key-here"

    with ChatClient(api_key) as client:
        try:
            response = client.create_chat_message(
                inputs={}, query="Tell me a story", user="user-789", response_mode="streaming"
            )

            print("Streaming response:")
            for line in response.iter_lines(decode_unicode=True):
                if line.startswith("data:"):
                    data = line[5:].strip()
                    if data:
                        import json

                        try:
                            chunk = json.loads(data)
                            answer = chunk.get("answer", "")
                            if answer:
                                print(answer, end="", flush=True)
                        except json.JSONDecodeError:
                            continue
            print()  # New line after streaming

        except Exception as e:
            print(f"Streaming error: {e}")


def example_application_info():
    """Example of getting application information."""
    api_key = "your-api-key-here"

    with DifyClient(api_key) as client:
        try:
            # Get app info
            info_response = client.get_app_info()
            info_response.raise_for_status()

            app_info = info_response.json()
            print(f"App name: {app_info.get('name')}")
            print(f"App mode: {app_info.get('mode')}")
            print(f"App tags: {app_info.get('tags', [])}")

            # Get app parameters
            params_response = client.get_application_parameters("user-123")
            params_response.raise_for_status()

            params = params_response.json()
            print(f"Opening statement: {params.get('opening_statement')}")
            print(f"Suggested questions: {params.get('suggested_questions', [])}")

        except Exception as e:
            print(f"App info error: {e}")


def main():
    """Run all examples."""
    setup_logging()

    print("=== Dify Python SDK Advanced Usage Examples ===\n")

    print("1. Chat with Error Handling:")
    example_chat_with_error_handling()
    print()

    print("2. Completion with Files:")
    example_completion_with_files()
    print()

    print("3. Dataset Management:")
    example_dataset_management()
    print()

    print("4. Async Chat:")
    asyncio.run(example_async_chat())
    print()

    print("5. Streaming Response:")
    example_streaming_response()
    print()

    print("6. Application Info:")
    example_application_info()
    print()

    print("All examples completed!")


if __name__ == "__main__":
    main()
