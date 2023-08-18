# 文本生成型应用

文本生成类应用是一种能够根据用户提供的提示，自动生成高质量文本的应用。它可以生成各种类型的文本，例如文章摘要、翻译等。

### 适用场景

文本生成类应用适用于需要大量文本创作的场景，例如新闻媒体、广告、SEO、市场营销等。它可以为这些行业提供高效、快速的文本生成服务，降低人力成本并提高生产效率。

### 如何编排

文本生成应用的编排支持：前缀前提示词，变量，上下文和生成更多类似的内容。

这边以做一个翻译应用为例来介绍编排文本生成型应用。

#### 第 1 步 创建应用

在首页点击 “创建应用” 按钮创建应用。填上应用名称，应用类型选择**文本生成应用**。

<figure><img src="../../.gitbook/assets/image (33).png" alt=""><figcaption><p>创建应用</p></figcaption></figure>

#### 第 2 步 编排应用

应用成功后会自动跳转到应用概览页。点击左侧菜单：**提示词编排** 来编排应用。

<figure><img src="../../.gitbook/assets/image (83).png" alt=""><figcaption></figcaption></figure>

**2.1 填写前缀提示词**

提示词用于对 AI 的回复做出一系列指令和约束。可插入表单变量，例如 `{{input}}`。提示词中的变量的值会替换成用户填写的值。

我们在这里填写的提示词是：`将内容翻译成：{{language}}。内容如下：`

![](<../../.gitbook/assets/image (65).png>)

#### 2.2 添加上下文

如果应用想基于私有的上下文对话来生成内容。可以用我们[数据集](../../advanced/datasets/)功能。在上下文中点 “添加” 按钮来添加数据集。

![](<../../.gitbook/assets/image (88).png>)

#### 2.3 添加功能：生成更多类似的

生成更多类似可以一次生成多条文本，可在此基础上编辑并继续生成。点击左上角的 “添加功能” 来打开该功能。

<figure><img src="../../.gitbook/assets/image (78).png" alt=""><figcaption><p>打开更多类似的功能</p></figcaption></figure>

**2.4 调试**

我们在右侧 输入变量 和 查询内容 进行调试。点 **“运行”** 按钮 查看运行的结果。

![](<../../.gitbook/assets/image (22).png>)

如果结果不理想，可以调整提示词和模型参数。点右上角点 模型名称 来设置模型的参数：

<div align="left">

<figure><img src="../../.gitbook/assets/image (35).png" alt="" width="375"><figcaption><p>调整模型参数</p></figcaption></figure>

</div>

**2.5 发布**

调试好应用后，点击右上角的 **“发布”** 按钮来保存当前的设置。

### 分享应用

在概览页可以找到应用的分享地址。点 “预览按钮” 预览分享出去的应用。点 “分享” 按钮获得分享的链接地址。点 “设置” 按钮设置分享出去的应用信息。

<figure><img src="../../.gitbook/assets/image (31).png" alt=""><figcaption></figcaption></figure>

如果想定制化分享出去的应用，可以 Fork 我们的开源的[ WebApp 的模版](https://github.com/langgenius/webapp-text-generator)。基于模版改成符合你的情景与风格需求的应用。





