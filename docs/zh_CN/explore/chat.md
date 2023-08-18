# 智聊

智聊是用于探索 Dify 能力边界的对话型应用。

在我们和自然语言大模型对话时，经常会遇到回答内容过期或者失效的情况，这是由于大模型的训练数据较老以及无联网能力导致的，智聊在大模型的基础上，利用代理(Agent) 的能力以及一些工具为大模型赋予了联网实时查询的能力。

<figure><img src="../.gitbook/assets/image (89).png" alt=""><figcaption></figcaption></figure>

智聊支持使用插件和数据集。

### 使用插件

大语言模型不能联网和调用外部工具。但这不能满足实际的使用场景，比如：

* 我们想知道今天的天气时，需要联网。
* 我们想总结某个网页的内容时，需要使用外部工具：读取网页内容。

使用代理模式，可以解决上面的问题：当大语言模型没法解答用户的问题时，会尝试使用现有的插件来解答问题。

{% hint style="info" %}
在 Dify 中，对于不同的模型，我们用了不同的代理策略。OpenAI 的模型使用的代理策略是 **GPT function call。**其他模型使用是 **`ReACT`**`。目前测试的体验是`**GPT function call** 的效果更好`。想了解更多，可以阅读下面的链接：`

* [Function calling and other API updates](https://openai.com/blog/function-calling-and-other-api-updates)
* [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)


{% endhint %}

目前我们支持如下插件：

* 谷歌搜索。该插件会搜索谷歌找答案。
* 解析链接。该插件会读取链接的网页内容。
* 维基百科。该插件会搜索维基百科找答案。

我们可以在对话开始前选择本次对话需要的插件。

<figure><img src="../.gitbook/assets/image (75).png" alt=""><figcaption></figcaption></figure>

如果使用谷歌搜索插件，需要配置 SerpAPI key。

<figure><img src="../.gitbook/assets/image (82).png" alt=""><figcaption></figcaption></figure>

配置的入口：

<figure><img src="../.gitbook/assets/image (104).png" alt=""><figcaption></figcaption></figure>

### 使用数据集

智聊支持数据集。选择了数据集后，用户问的问题和数据集内容有关，模型会从数据集中找答案。

我们可以在对话开始前选择本次对话需要的数据集。

<figure><img src="../.gitbook/assets/image (52).png" alt=""><figcaption></figcaption></figure>

### 思考的过程

思考的过程指模型使用插件和数据集的过程。我们可以在每个回答中看到思考的过程。

<figure><img src="../.gitbook/assets/image (60).png" alt=""><figcaption></figcaption></figure>



