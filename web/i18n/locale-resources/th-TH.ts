export const loadResource = (fileNamespace: string) =>
  import(`../locales/th-TH/${fileNamespace}.json`)
