export const loadResource = (fileNamespace: string) =>
  import(`../locales/it-IT/${fileNamespace}.json`)
