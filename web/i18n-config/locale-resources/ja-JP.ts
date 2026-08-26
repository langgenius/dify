export const loadResource = (fileNamespace: string) =>
  import(`../../i18n/ja-JP/${fileNamespace}.json`)
