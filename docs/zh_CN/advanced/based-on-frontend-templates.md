# 基于前端模版再开发

如果开发者是从头开发新产品或者在产品原型设计阶段，你可以使用 Dify 快速发布 AI 站点。与此同时，Dify 希望开发者能够充分自由的创造不同形式的前端应用，为此我们提供了：

* **SDK**，用于在各种语言中快速接入 Dify API
* **WebApp Template**，每种类型应用的 WebApp 开发脚手架

WebApp Template 是基于 MIT 协议开源的，你可以充分自由的修改并部署他们，以实现 Dify 的所有能力。或者作为你实现自己 App 的一份参考代码。

你可以在 GitHub 中找到这些 Template：

* [对话型应用](https://github.com/langgenius/webapp-conversation)
* [文本生成型应用](https://github.com/langgenius/webapp-text-generator)

使用 WebApp 模版最快的方法就是在 GitHub 中点击「使用这个模版」，它相当于 Fork 了一个新的仓库。随后你需要配置 Dify 的 App ID 和 API Key，类似这样：

````javascript
export const APP_ID = ''
export const API_KEY = ''
```

More config in `config/index.ts`:
```js
export const APP_INFO: AppInfo = {
  "title": 'Chat APP',
  "description": '',
  "copyright": '',
  "privacy_policy": '',
  "default_language": 'zh-Hans'
}

export const isShowPrompt = true
export const promptTemplate = ''
````

每一种 WebApp 模版都提供了 README 文件，内含部署方式的说明。通常，WebApp 模版都包含了一个轻后端服务，这是为了确保开发者的 API KEY 不会直接暴露给用户。

这些 WebApp 模版能够帮助你快速搭建起 AI 应用原型，并使用 Dify 的所有能力。如果你基于它们开发了自己的应用或新的模版，欢迎你与我们分享。
