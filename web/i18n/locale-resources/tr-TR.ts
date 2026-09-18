export const loadResource = (fileNamespace: string) =>
  import(`../locales/tr-TR/${fileNamespace}.json`)
