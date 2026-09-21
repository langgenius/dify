export const loadResource = (fileNamespace: string) =>
  import(`../locales/hi-IN/${fileNamespace}.json`)
