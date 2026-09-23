export const loadResource = (fileNamespace: string) =>
  import(`../locales/id-ID/${fileNamespace}.json`)
