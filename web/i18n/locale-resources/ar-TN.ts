export const loadResource = (fileNamespace: string) =>
  import(`../locales/ar-TN/${fileNamespace}.json`)
