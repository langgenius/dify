# Developing with APIs

Dify offers a "Backend-as-a-Service" API, providing numerous benefits to AI application developers. This approach enables developers to access the powerful capabilities of large language models (LLMs) directly in frontend applications without the complexities of backend architecture and deployment processes.

### Benefits of using Dify API

* Allow frontend apps to securely access LLM capabilities without backend development
* Design applications visually with real-time updates across all clients
* Well-encapsulated original LLM APIs
* Effortlessly switch between LLM providers and centrally manage API keys
* Operate applications visually, including log analysis, annotation, and user activity observation
* Continuously provide more tools, plugins, and datasets

### How to use

Choose an application, and find the API Access in the left-side navigation of the Apps section. On this page, you can view the API documentation provided by Dify and manage credentials for accessing the API.

<figure><img src="../.gitbook/assets/API Access.png" alt=""><figcaption><p>API document</p></figcaption></figure>

You can create multiple access credentials for an application to deliver to different users or developers. This means that API users can use the AI capabilities provided by the application developer, but the underlying Prompt engineering, datasets, and tool capabilities are encapsulated.

{% hint style="warning" %}
In best practices, API keys should be called through the backend, rather than being directly exposed in plaintext within frontend code or requests. This helps prevent your application from being abused or attacked.
{% endhint %}

For example, if you're a developer in a consulting company, you can offer AI capabilities based on the company's private database to end-users or developers, without exposing your data and AI logic design. This ensures a secure and sustainable service delivery that meets business objectives.

### Text-generation application

These applications are used to generate high-quality text, such as articles, summaries, translations, etc., by calling the completion-messages API and sending user input to obtain generated text results. The model parameters and prompt templates used for generating text depend on the developer's settings in the Dify Prompt Arrangement page.

You can find the API documentation and example requests for this application in **Applications -> Access API**.

For example, here is a sample call  an API for text generation:

```
curl --location --request POST 'https://api.dify.dev/v1/completion-messages' \
--header 'Authorization: Bearer ENTER-YOUR-SECRET-KEY' \
--header 'Content-Type: application/json' \
--data-raw '{
    "inputs": {},
    "query": "Hi",
    "response_mode": "streaming",
    "user": "abc-123"
}'
```



### Conversational applications

Suitable for most scenarios, conversational applications engage in continuous dialogue with users in a question-and-answer format. To start a conversation, call the chat-messages API and maintain the session by continuously passing in the returned conversation_id.

You can find the API documentation and example requests for this application in **Applications -> Access API**.

For example, here is a sample call an API for chat-messages:

```
curl --location --request POST 'https://api.dify.dev/v1/chat-messages' \
--header 'Authorization: Bearer ENTER-YOUR-SECRET-KEY' \
--header 'Content-Type: application/json' \
--data-raw '{
    "inputs": {},
    "query": "eh",
    "response_mode": "streaming",
    "conversation_id": "1c7e55fb-1ba2-4e10-81b5-30addcea2276"
    "user": "abc-123"
}'
```
