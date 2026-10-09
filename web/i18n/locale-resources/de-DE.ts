export const loadResource = (fileNamespace: string) =>
  import(`../locales/de-DE/${fileNamespace}.json`)
