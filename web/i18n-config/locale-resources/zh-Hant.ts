export const loadResource = (fileNamespace: string) =>
  import(`../../i18n/zh-Hant/${fileNamespace}.json`)
