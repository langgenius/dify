# 文本生成型应用

文本生成类应用是一种根据用户提供的提示，自动生成高质量文本的应用。它可以生成各种类型的文本，例如文章摘要、翻译等。



文本生成型应用支持如下功能：

1. 运行一次。
2. 批量运行。
3. 保存运行结果。
4. 生成更多类似结果。

下面我们分别来介绍。

### 运行一次

输入查询内容，点击运行按钮，右侧会生成结果，如下图所示：

<figure><img src="../.gitbook/assets/image (58).png" alt=""><figcaption></figcaption></figure>

在生成的结果部分，点 “复制” 按钮可以将内容复制到剪贴板。点 “保存” 按钮可以保存内容。可以在 “已保存” 选项卡中看到保存过的内容。也可以对生成的内容点 “赞” 和 “踩”。

### 批量运行

有时，我们需要运行一个应用很多次。比如：有个 Web 应用可以根据主题来生成文章。现在要生成 100 篇不同主题的文章。那么这个任务要做 100 次，很麻烦。而且，必须等一个任务完成才能开始下一个任务。

上面的场景，用批量运行功能，操作便利(把主题录入一个 `csv` 文件，只需执行一次)，也节约了生成的时间(多个任务同时运行)。使用方式如下：

#### 第 1 步 进入批量运行页面

点击 “批量运行” 选项卡，则会进入批量运行页面。

<figure><img src="../.gitbook/assets/image (73).png" alt=""><figcaption></figcaption></figure>

#### 第 2 步 下载模版并填写内容

点击下载模版按钮，下载模版。编辑模版，填写内容，并另存为 `.csv` 格式的文件。

<figure><img src="../.gitbook/assets/image (36).png" alt=""><figcaption></figcaption></figure>

#### 第 3 步 上传文件并运行

<figure><img src="../.gitbook/assets/image (70).png" alt=""><figcaption></figcaption></figure>

如果需要导出生成的内容，可以点右上角的下载 “按钮” 来导出为 `csv` 文件。

### 保存运行结果

点击生成结果下面的 “保存” 按钮，可以保存运行结果。在 “已保存” 选项卡中，可以看到所有已保存的内容。

<figure><img src="../.gitbook/assets/image (57).png" alt=""><figcaption></figcaption></figure>

### 生成更多类似结果

如果在应用编排时开启了 “更多类似” 的功能。在 Web 应用中可以点击 “更多类似” 的按钮来生成和当前结果相似的内容。如下图所示：

<figure><img src="../.gitbook/assets/image (39).png" alt=""><figcaption></figcaption></figure>
