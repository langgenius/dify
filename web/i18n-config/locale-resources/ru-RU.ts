export const loadResource = (fileNamespace: string) =>
  import(`../../i18n/ru-RU/${fileNamespace}.json`)
