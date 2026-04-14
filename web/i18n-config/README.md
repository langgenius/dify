# Internationalization (i18n)

## Introduction

This directory contains i18n tooling and configuration. Translation files live under `web/i18n`.

## File Structure

```txt
web/i18n
├── en-US
│   ├── app.json
│   ├── app-debug.json
│   ├── common.json
│   └── ...
└── zh-Hans
    └── ...

web/i18n-config
├── language.ts
├── i18next-config.ts
└── ...
```

We use English as the default language. Translation files are organized by language and then by module. For example, the English translation for the `app` module is in `web/i18n/en-US/app.json`.

Translation files are JSON with flat keys (dot notation). i18next is configured with `keySeparator: false`, so dots are part of the key. The namespace is the camelCase file name (for example, `app-debug.json` -> `appDebug`), so use `useTranslation('appDebug')` or `t('key', { ns: 'appDebug' })`.

If you want to add a new language or modify an existing translation, create or update the `.json` files in the language folder.

For example, if you want to add French translation, you can create a new folder `fr-FR` and add the translation files in it.

By default we will use `LanguagesSupported` to determine which languages are supported. For example, in login page and settings page, we will use `LanguagesSupported` to determine which languages are supported and display them in the language selection dropdown.

## Example

1. Create a new folder for the new language.

```txt
cd web/i18n
cp -r en-US id-ID
```

1. Modify the translation `.json` files in the new folder. Keep keys flat (for example, `dialog.title`).

1. Add the new language to the `languages.ts` file.

```typescript
export const languages = [
  {
    value: 'en-US',
    name: 'English(United States)',
    example: 'Hello, Dify!',
    supported: true,
  },
  {
    value: 'zh-Hans',
    name: '简体中文',
    example: '你好，Dify！',
    supported: true,
  },
  {
    value: 'pt-BR',
    name: 'Português(Brasil)',
    example: 'Olá, Dify!',
    supported: true,
  },
  {
    value: 'es-ES',
    name: 'Español(España)',
    example: 'Saluton, Dify!',
    supported: false,
  },
  {
    value: 'fr-FR',
    name: 'Français(France)',
    example: 'Bonjour, Dify!',
    supported: false,
  },
  {
    value: 'de-DE',
    name: 'Deutsch(Deutschland)',
    example: 'Hallo, Dify!',
    supported: false,
  },
  {
    value: 'ja-JP',
    name: '日本語 (日本)',
    example: 'こんにちは、Dify!',
    supported: false,
  },
  {
    value: 'ko-KR',
    name: '한국어 (대한민국)',
    example: '안녕, Dify!',
    supported: true,
  },
  {
    value: 'ru-RU',
    name: 'Русский(Россия)',
    example: 'Привет, Dify!',
    supported: false,
  },
  {
    value: 'it-IT',
    name: 'Italiano(Italia)',
    example: 'Ciao, Dify!',
    supported: false,
  },
  {
    value: 'th-TH',
    name: 'ไทย(ประเทศไทย)',
    example: 'สวัสดี Dify!',
    supported: false,
  },
  {
    value: 'id-ID',
    name: 'Bahasa Indonesia',
    example: 'Halo, Dify!',
    supported: true,
  },
  {
    value: 'uk-UA',
    name: 'Українська(Україна)',
    example: 'Привет, Dify!',
    supported: true,
  },
  {
    value: 'fa-IR',
    name: 'Farsi (Iran)',
    example: 'سلام, دیفای!',
    supported: true,
  },
  {
    value: 'ar-TN',
    name: 'العربية (تونس)',
    example: 'مرحبا، Dify!',
    supported: true,
  },
  // Add your language here 👇
  // ...
  // Add your language here 👆
]
```

1. Don't forget to mark the supported field as `true` if the language is supported.

1. Sometimes you might need to do some changes in the server side. Please change this file as well. 👇
   <https://github.com/langgenius/dify/blob/61e4bbabaf2758354db4073cbea09fdd21a5bec1/api/constants/languages.py#L5>

> Note: `I18nText` type is automatically derived from `LanguagesSupported`, so you don't need to manually add types.

## Clean Up

That's it! You have successfully added a new language to the project. If you want to remove a language, you can simply delete the folder and remove the language from the `languages.ts` file.

We have a list of languages that we support in the `languages.ts` file. But some of them are not supported yet. So, they are marked as `false`. If you want to support a language, you can follow the steps above and mark the supported field as `true`.

## Utility scripts

- Check missing/extra keys: `pnpm run i18n:check --file app billing --lang zh-Hans [--auto-remove]`
  - Use space-separated values; repeat `--file` / `--lang` as needed. Returns non-zero on missing/extra keys; `--auto-remove` deletes extra keys automatically.

## Automatic Translation

Translation is handled automatically by Claude Code GitHub Actions. When changes are pushed to `web/i18n/en-US/*.json` on the main branch:

1. Claude Code analyzes the git diff to detect changes
1. Identifies three types of changes:
   - **ADD**: New keys that need translation
   - **UPDATE**: Modified keys that need re-translation (even if target language has existing translation)
   - **DELETE**: Removed keys that need to be deleted from other languages
1. Runs `i18n:check` to verify the initial sync status.
1. Translates missing/updated keys while preserving placeholders (`{{var}}`, `${var}`, `<tag>`) and removes deleted keys.
1. Runs `lint:fix` to sort JSON keys and `i18n:check` again to ensure everything is synchronized.
1. Creates a PR with the translations.

### Manual Trigger

To manually trigger translation:

1. Go to Actions > "Translate i18n Files with Claude Code"
1. Click "Run workflow"
1. Optionally configure:
   - **files**: Specific files to translate (space-separated, e.g., "app common")
   - **languages**: Specific languages to translate (space-separated, e.g., "zh-Hans ja-JP")
   - **mode**: `incremental` (default, only changes) or `full` (check all keys)

Workflow: `.github/workflows/translate-i18n-claude.yml`
