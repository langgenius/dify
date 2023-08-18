# How to Build an Notion AI Assistant Based on Your Own Notes?

### Intro[​](https://wsyfin.com/notion-dify#intro) <a href="#intro" id="intro"></a>

Notion is a powerful tool for managing knowledge. Its flexibility and extensibility make it an excellent personal knowledge library and shared workspace. Many people use it to store their knowledge and work in collaboration with others, facilitating the exchange of ideas and the creation of new knowledge.

However, this knowledge remains static, as users must search for the information they need and read through it to find the answers they're seeking. This process is neither particularly efficient nor intelligent.

Have you ever dreamed of having an AI assistant based on your Notion library? This assistant would not only assist you in reviewing your knowledge base, but also engage in the communication like a seasoned butler, even answering other people's questions as if you were the master of your personal Notion library.

### How to Make Your Notion AI Assistant Come True?[​](https://wsyfin.com/notion-dify#how-to-make-your-notion-ai-assistant-come-true) <a href="#how-to-make-your-notion-ai-assistant-come-true" id="how-to-make-your-notion-ai-assistant-come-true"></a>

Now, you can make this dream come true through [Dify](https://dify.ai/). Dify is an open-source LLMOps (Large Language Models Ops) platform.

Large Language Models like ChatGPT and Claude, have been using their impressive abilities to reshape the world. Their powerful learning aptitude primarily attributable to robust training data. Luckily, they've evolved to be sufficiently intelligent to learn from the content you provide, thus making the process of ideating from your personal Notion library, a reality.

Without Dify, you might need to acquaint yourself with langchain, an abstraction that streamlines the process of assembling these pieces.

### How to Use Dify to Build Your Personal Notion AI Assistant?[​](https://wsyfin.com/notion-dify#how-to-use-dify-to-build-your-own-ai-assistant) <a href="#how-to-use-dify-to-build-your-own-ai-assistant" id="how-to-use-dify-to-build-your-own-ai-assistant"></a>

The process to train a Notion AI assistant is relatively straightforward. Just follow these steps:

1. Login to Dify.
2. Create a new datasets.
3. Connect with Notion and your datasets.
4. Start training.
5. Create your own AI application.

#### 1. Login to dify[​](https://wsyfin.com/notion-dify#1-login-to-dify) <a href="#1-login-to-dify" id="1-login-to-dify"></a>

Click [here](https://dify.ai/) to login to Dify. You can conveniently log in using your GitHub or Google account.

> If you are using GitHub account to login, how about getting this [project](https://github.com/langgenius/dify) a star? It really help us a lot!

![login-1](https://pan.wsyfin.com/f/ERGcp/login-1.png)

#### 2. Create new datasets[​](https://wsyfin.com/notion-dify#2-create-a-new-datasets)[​](https://wsyfin.com/notion-dify#2-create-a-new-datasets)

Click the `Datasets` button on the top side bar, followed by the `Create Dataset` button.

![login-2](https://pan.wsyfin.com/f/G6ziA/login-2.png)

#### 3. Connect with Notion and Your Datasets[​](https://wsyfin.com/notion-dify#3-connect-with-notion-and-datasets)

Select "Sync from Notion" and then click the "Connect" button..

![connect-with-notion-1](https://pan.wsyfin.com/f/J6WsK/connect-with-notion-1.png)

Afterward, you'll be redirected to the Notion login page. Log in with your Notion account.

<figure><img src="https://pan.wsyfin.com/f/KrEi4/connect-with-notion-2.png" alt=""><figcaption></figcaption></figure>

Check the permissions needed by Dify, and then click the "Select pages" button.

<figure><img src="https://pan.wsyfin.com/f/L91iQ/connect-with-notion-3.png" alt=""><figcaption></figcaption></figure>

Select the pages you want to synchronize with Dify, and press the "Allow access" button.

<figure><img src="https://pan.wsyfin.com/f/M8Xtz/connect-with-notion-4.png" alt=""><figcaption></figcaption></figure>

#### 4. Start training[​](https://wsyfin.com/notion-dify#4-start-training) <a href="#4-start-training" id="4-start-training"></a>

Specifying the pages for AI need to study, enabling it to comprehend the content within this section of Notion. Then click the "next" button.

![train-1](https://pan.wsyfin.com/f/Nkjuj/train-1.png)

We suggest selecting the "Automatic" and "High Quality" options to train your AI assistant. Then click the "Save & Process" button.

![train-2](https://pan.wsyfin.com/f/OYoCv/train-2.png)

Enjoy your coffee while waiting for the training process to complete.

![train-3](https://pan.wsyfin.com/f/PN9F3/train-3.png)

#### 5. Create Your AI application[​](https://wsyfin.com/notion-dify#5-create-your-ai-application) <a href="#5-create-your-own-ai-application" id="5-create-your-own-ai-application"></a>

You must create an AI application and link it with the dataset you've recently created.

Return to the dashboard, and click the "Create new APP" button. It's recommended to use the Chat App directly.

![create-app-1](https://pan.wsyfin.com/f/QWRHo/create-app-1.png)

Select the "Prompt Eng." and link your notion datasets in the "context".

![create-app-2](https://pan.wsyfin.com/f/R6DT5/create-app-2.png)

I recommend adding a 'Pre Prompt' to your AI application. Just like spells are essential to Harry Potter, similarly, certain tools or features can greatly enhance the ability of AI application.

For example, if your Notion notes focus on problem-solving in software development, could write in one of the prompts:

_I want you to act as an IT Expert in my Notion workspace, using your knowledge of computer science, network infrastructure, Notion notes, and IT security to solve the problems_.

<figure><img src="../.gitbook/assets/image (40).png" alt=""><figcaption></figcaption></figure>

It's recommended to initially enable the AI to actively furnish the users with a starter sentence, providing a clue as to what they can ask. Furthermore, activating the 'Speech to Text' feature can allow users to interact with your AI assistant using their voice.

<figure><img src="../.gitbook/assets/image (3).png" alt=""><figcaption></figcaption></figure>

Finally, Click the "Publish" button on the top right of the page. Now you can click the public URL in the "Overview" section to converse with your personalized AI assistant!

![create-app-4](https://pan.wsyfin.com/f/W69cD/create-app-4.png)

### Utilizing API to Integrate With Your Project <a href="#utilizing-api-to-integrate-with-your-project" id="utilizing-api-to-integrate-with-your-project"></a>

Each AI application baked by Dify can be accessed via its API. This method allows developers to tap directly into the robust characteristics of large language models (LLMs) within frontend applications, delivering a true "Backend-as-a-Service" (BaaS) experience.

With effortless API integration, you can conveniently invoke your Notion AI application without the need for intricate configurations.

Click the "API Reference" button on the page of Overview page. You can refer to it as your App's API document.

![using-api-1](https://pan.wsyfin.com/f/wp0Cy/using-api-1.png)

#### 1. Generate API Secret Key[​](https://wsyfin.com/notion-dify#1-generate-api-secret-key) <a href="#1-generate-api-secret-key" id="1-generate-api-secret-key"></a>

For sercurity reason, it's recommened to create new API secret key to access your AI application.

![using-api-2](https://pan.wsyfin.com/f/xk2Fx/using-api-2.png)

#### 2. Retrieve Conversation ID[​](https://wsyfin.com/notion-dify#2-retrieve-conversation-id) <a href="#2-retrieve-conversation-id" id="2-retrieve-conversation-id"></a>

After chatting with your AI application, you can retrieve the session ID from the "Logs & Ann." pages.

![using-api-3](https://pan.wsyfin.com/f/yPXHL/using-api-3.png)

#### 3. Invoke API[​](https://wsyfin.com/notion-dify#3-invoke-api) <a href="#3-invoke-api" id="3-invoke-api"></a>

You can run the example request code on the API document to invoke your AI application in terminal.

Remember to replace `YOUR SECRET KEY` and `conversation_id` on your code.

> You can input empty `conversation_id` at the first time, and replace it after you receive response contained `conversation_id`.

```
curl --location --request POST 'https://api.dify.ai/v1/chat-messages' \
--header 'Authorization: Bearer ENTER-YOUR-SECRET-KEY' \
--header 'Content-Type: application/json' \
--data-raw '{
    "inputs": {},
    "query": "eh",
    "response_mode": "streaming",
    "conversation_id": "",
    "user": "abc-123"
}'
```

Sending request in terminal and you will get a successful response.

![using-api-4](https://pan.wsyfin.com/f/zpnI4/using-api-4.png)

If you want to continue this chat, go to replace the `conversation_id` of the request code to the `conversation_id` you get from the response.

And you can check all the conversation history on the "Logs & Ann." page.

![using-api-5](https://pan.wsyfin.com/f/ADQSE/using-api-5.png)

### Sync with notion periodically[​](https://wsyfin.com/notion-dify#sync-with-notion-periodically) <a href="#sync-with-notion-periodically" id="sync-with-notion-periodically"></a>

If your Notion's pages have updated, you can sync with Dify periodically to keep your AI assistant up-to-date. Your AI assistant will learn from the new content.

![create-app-5](https://pan.wsyfin.com/f/XDBfO/create-app-5.png)

### Summary[​](https://wsyfin.com/notion-dify#summary) <a href="#summary" id="summary"></a>

In this tutorial, we have learned not only how to import Your Notion data into Dify, but also know how to use the API to integrate it with your project.

[Dify](https://dify.ai/) is a user-friendly LLMOps platform targeted to empower more individuals to create sustainable, AI-native applications. With visual orchestration designed for various application types, Dify offers ready-to-use applications that can assist you in utilizing data to craft your distinctive AI assistant. Do not hesitate to contact us if you have any inquiries.
