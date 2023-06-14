# 前端 i18n 修改

## 后端多语言支持

`api/libs/helper.py:117` 中添加对应的语言支持。如：
```python
def supported_language(lang):
    if lang in ['en-US', 'zh-Hans', 'de', 'de-AT']:
        return lang
```


## 添加多语言文件

在 `web/i18n/lang` 下添加不同模块的多语言文件。文件命令为 模块名.{LANG}.ts。详细参考[LANG](https://www.venea.net/web/culture_code) 

## 引入新添加的多语言文件
在 `web/i18n/i18next-config.ts` 中 resources 对象中中引入新添加的多语言文件。如：

```javascript
const resources = {
    'en': {...},
    'zh-Hans': {...},
    // 引入新添加的语言
    'new LANG': {
      translation: {
        common: commonNewLan,
        layout: layoutNewLan,
        ...
      }
    }
}
```

## 翻译过程中的改动

### 日期格式化的多语言处理

目前日期做多语言格式化的文件涉及到如下 2 个: 

```javascript
1. web/app/components/header/account-setting/members-page/index.tsx
// Line: 78 
{dayjs(Number((account.last_login_at || account.created_at)) * 1000).locale(locale === 'zh-Hans' ? 'zh-cn' : 'en').fromNow()}
2. web/app/components/develop/secret-key/secret-key-modal.tsx
// Line：82
const formatDate = (timestamp: any) => {
    if (locale === 'en') {
      return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format((+timestamp) * 1000)
    } else {
      return new Intl.DateTimeFormat('fr-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format((+timestamp) * 1000)
    }
  }
```
看需求做对应的改动。

### 翻译中带变量的内容的处理

翻译中会存在带变量的情况，变量的值会在运行时被替换。翻译中的变量会用{{ 和 }} 包裹。
翻译带变量的内容时：
  1. 不能改变量的名称。即：变量的名称不需要做翻译。
  2. 确保变量填充后，语句仍保持通顺。

查找所有翻译中带变量的方式：在 ./web/i18n/lang 下搜索：{{。

### 翻译内容太长破坏 UI

如果某个翻译的内容比其他语言的长很多，检查下是否会破坏 UI。

## 帮助文档

目前的帮助文档的调整逻辑是：中文跳转中文，其他语言跳英文。如果帮助文档也做了多语言。需要做这块的改动。

## 验证

新增语言包建议通过本地部署最新代码来验证，可参考：https://docs.dify.ai/getting-started/install-self-hosted/local-source-code
验证点：
1. 首次初始化安装是否存在新语言下拉选项，以及是否可以用新语言进行初始化
2. 个人设置中是否存在新语言下拉选项，以及是否可以选择并保存新语言
3. 界面各处文案是否使用新语言来展示，以及文案是否破坏 UI
4. 从模板创建应用内容是否均为新语言
5. （CLOUD 版）通过 OAuth 授权登录后，是否直接设置当前浏览器语言为界面语言
