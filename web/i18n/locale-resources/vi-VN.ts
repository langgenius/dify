export const loadResource = (fileNamespace: string) =>
  import(`../locales/vi-VN/${fileNamespace}.json`)
