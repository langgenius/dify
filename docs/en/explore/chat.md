# Chat

Chat in explore is a conversational application used to explore the boundaries of Dify's capabilities.

When we talk to large natural language models, we often encounter situations where the answers are outdated or invalid. This is due to the old training data of the large model and the lack of networking capabilities. Based on the large model, Chat uses agents to capabilities and some tools endow the large model with the ability of online real-time query.

<figure><img src="../.gitbook/assets/image (61).png" alt=""><figcaption></figcaption></figure>

Chat supports the use of plugins and datasets.

### Use plugins

LLM(Large language model)cannot be networked and invoke external tools. But this cannot meet the actual usage scenarios, such as:

* When we want to know the weather today, we need to be connected to the Internet.
* When we want to summarize the content of a web page, we need to use an external tool: read the content of the web page.

The above problem can be solved by using the agent mode: when the LLM cannot answer the user's question, it will try to use the existing plugins to answer the question.

{% hint style="info" %}
In Dify, we use different proxy strategies for different models. The proxy strategy used by OpenAI's model is **GPT function call**. Another model used is **ReACT**. The current test experience is that the effect of **GPT function call** is better. To know more, you can read the link below:

* [Function calling and other API updates](https://openai.com/blog/function-calling-and-other-api-updates)
* [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)
{% endhint %}

Currently we support the following plugins:

* Google Search. The plugin searches Google for answers.
* Web Reader. The plugin reads the content of linked web pages.
* Wikipedia. The plugin searches Wikipedia for answers.

We can choose the plugins needed for this conversation before the conversation starts.

<figure><img src="../.gitbook/assets/image (4).png" alt=""><figcaption></figcaption></figure>

If you use the Google search plugin, you need to configure the SerpAPI key.

<figure><img src="../.gitbook/assets/image (31).png" alt=""><figcaption></figcaption></figure>

Configured entry:

<figure><img src="../.gitbook/assets/image (18).png" alt=""><figcaption></figcaption></figure>

### Use datasets

Chat supports datasets. After selecting the datasets, the questions asked by the user are related to the content of the data set, and the model will find the answer from the data set.

We can select the datasets needed for this conversation before the conversation starts.

<figure><img src="../.gitbook/assets/image (5).png" alt=""><figcaption></figcaption></figure>



### The process of thinking

The thinking process refers to the process of the model using plugins and datasets. We can see the thought process in each answer.

<figure><img src="../.gitbook/assets/image (23).png" alt=""><figcaption></figcaption></figure>

