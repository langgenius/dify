# Based on WebApp Template

If developers are developing new products from scratch or in the product prototype design phase, you can quickly launch AI sites using Dify. At the same time, Dify hopes that developers can fully freely create different forms of front-end applications. For this reason, we provide:

* **SDK** for quick access to the Dify API in various languages
* **WebApp Template** for WebApp development scaffolding for each type of application

The WebApp Templates are open source under the MIT license. You are free to modify and deploy them to achieve all the capabilities of Dify or as a reference code for implementing your own App.

You can find these Templates on GitHub:

* [Conversational app](https://github.com/langgenius/webapp-conversation)
* [Text generation app](https://github.com/langgenius/webapp-text-generator)

The fastest way to use the WebApp Template is to click "**Use this template**" on GitHub, which is equivalent to forking a new repository. Then you need to configure the Dify App ID and API Key, like this:

```javascript
export const APP_ID = ''
export const API_KEY = ''
```

More config in `config/index.ts`:

```
export const APP_INFO: AppInfo = {
  "title": 'Chat APP',
  "description": '',
  "copyright": '',
  "privacy_policy": '',
  "default_language": 'zh-Hans'
}

export const isShowPrompt = true
export const promptTemplate = ''
```

Each WebApp Template provides a README file containing deployment instructions. Usually, WebApp Templates contain a lightweight backend service to ensure that developers' API keys are not directly exposed to users.

These WebApp Templates can help you quickly build prototypes of AI applications and use all the capabilities of Dify. If you develop your own applications or new templates based on them, feel free to share with us.
