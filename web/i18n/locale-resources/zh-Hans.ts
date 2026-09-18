export const loadResource = (fileNamespace: string) =>
  import(`../locales/zh-Hans/${fileNamespace}.json`)
