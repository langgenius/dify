# Dify Chat API Proxy for Cloudflare Workers

This is a Cloudflare Workers script that proxies the Dify conversational application API and transforms the output format to match the OpenAI Chat Completions API. By deploying this script to your Cloudflare Workers, you can immediately start using the Dify API with the familiar OpenAI API format.

## Features

- Proxies the Dify conversational application API
- Converts the Dify API response format to match the OpenAI Chat Completions API
- Supports both streaming and non-streaming responses
- Handles CORS (Cross-Origin Resource Sharing) headers for seamless integration with web applications

## Prerequisites

- A Cloudflare account with the Workers feature enabled
- A Dify API key

## Installation

1. Create a new Cloudflare Worker:
   - Log in to your Cloudflare account
   - Navigate to the "Workers" section
   - Click on "Create a Service"
   - Choose a name for your worker and select a starter template (e.g., "HTTP Handler")

2. Replace the default code in the worker's script editor with the provided code from `workers.js`.

3. Configure the API key:
   - Replace the placeholder API key check logic in the `handleRequest` function with your own authorization logic.
   - For example, you can check if the API key is defined in the environment variables, like `DifyAPIKey = app-xxxxxxxxxxxxxxxxxx`.

4. Deploy the worker:
   - Click on "Save and Deploy" to deploy your worker.

## Usage

To use the Dify Chat API Proxy, make a POST request to your worker's URL with the following parameters:

- URL: `https://your-worker-url.workers.dev/v1/chat/completions`
- Method: POST
- Headers:
  - `Content-Type: application/json`
  - `Authorization: Bearer YOUR_API_KEY`
- Body (JSON):
  ```json
  {
    "messages": [
      {
        "content": "Your message content"
      }
    ],
    "stream": true
  }
  ```

Replace `YOUR_API_KEY` with your actual Dify API key.

The `messages` array should contain the message objects with the `content` property representing the message content. The `stream` parameter is optional and can be set to `true` for streaming responses or `false` (or omitted) for non-streaming responses.

The proxy will forward the request to the Dify API, transform the response format to match the OpenAI Chat Completions API, and return the response.

## Example

Here's an example of how to make a request to the Dify Chat API Proxy using the standard HTTP/1.1 protocol:

```http
POST /v1/chat/completions HTTP/1.1
Host: your-worker-url.workers.dev
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY

{
  "messages": [
    {
      "content": "Hello, how are you?"
    }
  ],
  "stream": true
}
```

Make sure to replace `YOUR_API_KEY` with your actual Dify API key and `your-worker-url` with your deployed worker's URL.