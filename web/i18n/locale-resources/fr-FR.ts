export const loadResource = (fileNamespace: string) =>
  import(`../locales/fr-FR/${fileNamespace}.json`)
