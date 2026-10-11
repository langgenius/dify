export const loadResource = (fileNamespace: string) =>
  import(`../locales/ro-RO/${fileNamespace}.json`)
