export const loadResource = (fileNamespace: string) =>
  import(`../locales/ja-JP/${fileNamespace}.json`)
