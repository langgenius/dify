
## library

* i18next
* react-i18next

## hooks

* useTranslation
* useGetLanguage
* useI18N
* useRenderI18nObject

## impl

* App Boot
  - app/layout.tsx load i18n and init context
    - use `<I18nServer/>`
      - read locale with `getLocaleOnServer` (in node.js)
        - locale from cookie, or browser request header
        - only used in client app init and 2 server code(plugin desc, datasets)
      - use `<I18N/>`
        - init i18n context
        - `setLocaleOnClient`
          - `changeLanguage` (defined in i18n/i18next-config, also init i18n resources (side effects))
            * is `i18next.changeLanguage`
            * all languages text is merge & load in FrontEnd as .js (see i18n/i18next-config)
* i18n context
  - `locale` - current locale code (ex `eu-US`, `zh-Hans`)
  - `i18n` - useless
  - `setLocaleOnClient` - used by App Boot and user change language

### load i18n resources

- client: i18n/i18next-config.ts
  * ns = camalCase(filename)
  * ex: `app/components/datasets/create/embedding-process/index.tsx`
    * `t('datasetSettings.form.retrievalSetting.title')`
- server: i18n/server.ts
  * ns = filename
  * ex: `app/(commonLayout)/datasets/(datasetDetailLayout)/[datasetId]/settings/page.tsx`
    * `translate(locale, 'dataset-settings')`

## TODO

* [ ] ts docs for useGetLanguage
* [ ] ts docs for useI18N
* [ ] client docs for i18n
* [ ] server docs for i18n
