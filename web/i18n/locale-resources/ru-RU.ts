export const loadResource = (fileNamespace: string) =>
  import(`../locales/ru-RU/${fileNamespace}.json`)
