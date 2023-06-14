# Frontend i18n modification

## Backend i18n modification

`api/libs/helper.py:117` Add corresponding language support. Such as:
```python
def supported_language(lang):
    if lang in ['en-US', 'zh-Hans', 'de', 'de-AT']:
        return lang
```

## Adding multiple language files

Add multilingual files for different modules under web/i18n/lang. The file name is Module name.{LANG}.ts. Please refer [LANG](https://www.venea.net/web/culture_code) for details.

## Introducing a newly added multilingual file 

Introduce the newly added multilingual file in the resources object in web/i18n/i18next-config.ts. For example:

```javascript
const resources = {
    'en': {...},
    'zh-Hans': {...},  
    _// Introduce the newly added language_
    'new LANG': {  
      translation: {  
        common: commonNewLan,  
        layout: layoutNewLan,  
        ...  
      }  
    }
}
```
## Changes in the translation process

### Multi-language processing of date formatting

Currently, two files are involved in date formatting in multiple languages:

```javascript
1. web/app/components/header/account-setting/members-page/index.tsx
_// Line 78_   
{dayjs(Number((account.last_login_at || account.created_at)) * 1000).locale(locale === 'zh-Hans' ? 'zh-cn' : 'en').fromNow()}  
2. web/app/components/develop/secret-key/secret-key-modal.tsx  
_// Line 82_
const formatDate = (timestamp: any) => {
    if (locale === 'en') {  
      return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format((+timestamp) * 1000)  
    } else {  
      return new Intl.DateTimeFormat('fr-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format((+timestamp) * 1000)  
    }  
  }
```

Make corresponding changes based on requirements.

### Handling translation content with variables

There will be variables in the translation, and the value of the variables will be replaced at runtime. Variables in translation will be wrapped in {{ and }}.
When translating content with variables:
  1. Do not change the variable name. That is: the variable name does not need to be translated. 
  2. Ensure that the statement remains smooth after the variable is filled.
Find all translations with variables: search for {{ under ./web/i18n/lang. 

### Translation content is too long to destroy UI

If a certain translation content is much longer than other languages, check if it will destroy the UI.

## Help documentation

The current logic for adjusting the help documentation is: Chinese jumps to Chinese, other languages jump to English. If the help documentation is also multilingual, changes need to be made in this area. 

## Verification

It is recommended to verify the newly added language pack through local deployment of the latest code. For reference: https://docs.dify.ai/getting-started/install-self-hosted/local-source-code
Verification points:
1. Whether the initial installation has new language drop-down options, and whether the new language can be used for initialization
2. Whether there is a new language drop-down option in personal settings, and whether the new language can be selected and saved 
3. Whether the text in the interface is displayed in the new language, and whether the text destroys the UI
4. Whether the content created from the template is all in the new language
5. (CLOUD version) After logging in through OAuth authorization, whether the current browser language is set directly as the interface language
