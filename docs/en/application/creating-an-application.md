# Creating An Application

In Dify, an "application" refers to a real-world scenario application built on large language models such as GPT. By creating an application, you can apply intelligent AI technology to specific needs. It encompasses both the engineering paradigms for developing AI applications and the specific deliverables.

**In short, an application delivers to developers:**

* A user-friendly, encapsulated LLM API that can be called directly by backend or frontend applications with token authentication
* A ready-to-use, beautiful, and hosted Web App that you can develop further using the Web App templates
* A set of easy-to-use interfaces for Prompt Engineering, context management, log analysis, and annotation

You can choose one or all of them to support your AI application development.

### Application Types

Dify offers two types of applications: text generation and conversational. More application paradigms may appear in the future (we should keep up-to-date), and the ultimate goal of Dify is to cover more than 80% of typical LLM application scenarios. The differences between text generation and conversational applications are shown in the table below:

<table><thead><tr><th width="199.33333333333331"> </th><th>Text Generation</th><th>Conversational</th></tr></thead><tbody><tr><td>WebApp Interface</td><td>Form + Results</td><td>Chat style</td></tr><tr><td>API Endpoint</td><td><code>completion-messages</code></td><td><code>chat-messages</code></td></tr><tr><td>Interaction Mode</td><td>One question and one answer</td><td>Multi-turn dialogue</td></tr><tr><td>Streaming results return</td><td>Supported</td><td>Supported</td></tr><tr><td>Context Preservation</td><td>Current time</td><td>Continuous</td></tr><tr><td>User input form</td><td>Supported</td><td>Supported</td></tr><tr><td>Datasets&#x26;Plugins</td><td>Supported</td><td>Supported</td></tr><tr><td>AI opening remarks</td><td>Not supported</td><td>Supported</td></tr><tr><td>Scenario example</td><td>Translation, judgment, indexing</td><td>Chat or everything</td></tr></tbody></table>

### Steps to Create an Application

After logging in as an administrator in Dify, go to the main navigation application page Click "Create New Application" Choose a conversational or text generation application and give it a name (modifiable later)

<figure><img src="../.gitbook/assets/create a new App.png" alt=""><figcaption><p>Create a new App</p></figcaption></figure>

We provide some templates in the application creation interface, and you can click to create from a template in the popup when creating an application. These templates will provide inspiration and reference for the application you want to develop.

### Creating from a Configuration File

If you have obtained a template from the community or someone else, you can click to create from an application configuration file. Uploading the file will load most of the settings from the other party's application (but not the datasets at present).

### Your Application

If you are using it for the first time, you will be prompted to enter your OpenAI API key. A properly functioning LLM key is a prerequisite for using Dify. If you don't have one yet, please apply for one.

<figure><img src="../.gitbook/assets/OpenAI API Key.png" alt=""><figcaption><p>Enter your OpenAI API Key</p></figcaption></figure>

After creating an application or selecting an existing one, you will arrive at an application overview page showing the application's profile. You can directly access your WebApp or check the API status here, as well as enable or disable them.

Statistics show the usage, active user count, and LLM call consumption of the application over a period of time—enabling you to continually improve the cost-effectiveness of application operations. We will gradually provide more useful visualization capabilities; please let us know what you want.

1. Total Messages: Daily AI interactions count; prompt engineering/debugging excluded.
2. Active Users: Unique users engaging in Q\&A with AI; prompt engineering/debugging excluded.
3. Avg. Session Interactions: Continuous user-AI communication count; for conversation-based apps.
4. User Satisfaction Rate: Likes per 1,000 messages; indicates satisfaction with AI answers.
5. Avg. Response Time: Time (ms) for AI to process/respond; for text-based apps.
6. Token Usage: Daily language model token usage; for cost control.

### What's Next

* Try your WebApp
* Take a tour of the Configuration, Development, and Logs pages on the left
* Try configuring an application using a reference case
* If you have the ability to develop frontend applications, please consult the API documentation
