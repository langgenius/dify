export const loadResource = (fileNamespace: string) =>
  import(`../locales/zh-Hant/${fileNamespace}.json`)
