export const loadResource = (fileNamespace: string) =>
  import(`../locales/fa-IR/${fileNamespace}.json`)
