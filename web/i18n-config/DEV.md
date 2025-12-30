## library

- i18next
- react-i18next

## hooks

- useTranslation
- useGetLanguage
- useLocale
- useRenderI18nObject

## impl

- App Boot
  - app/layout.tsx load i18n and init context
    - use `<I18nServer/>`
      - read locale with `getLocaleOnServer` (in node.js)
        - locale from cookie, or browser request header
        - only used in client app init and 2 server code(plugin desc, datasets)
      - use `<I18N/>`
        - init i18n context
        - `setLocaleOnClient`
          - `changeLanguage` (defined in i18n/i18next-config, also init i18n resources (side effects))
            - is `i18next.changeLanguage`
            - loads JSON namespaces for the target locale and merges resource bundles (see i18n/i18next-config)
- i18n context
  - `locale` - current locale code (ex `eu-US`, `zh-Hans`)
  - `i18n` - useless
  - `setLocaleOnClient` - used by App Boot and user change language

### load i18n resources

- client: i18n/i18next-config.ts
  - ns = camelCase(filename) (app-debug -> appDebug)
  - keys are flat (dot notation); `keySeparator: false`
  - ex: `app/components/datasets/create/embedding-process/index.tsx`
    - `const { t } = useTranslation('datasetSettings')`
    - `t('form.retrievalSetting.title')`
- server: i18n/server.ts
  - ns = filename (kebab-case) mapped to camelCase namespace
  - ex: `app/(commonLayout)/datasets/(datasetDetailLayout)/[datasetId]/settings/page.tsx`
    - `const { t } = await getTranslation(locale, 'dataset-settings')`
    - `t('form.retrievalSetting.title')`

## TODO

- [ ] ts docs for useGetLanguage
- [ ] ts docs for useLocale
- [ ] client docs for i18n
- [ ] server docs for i18n
