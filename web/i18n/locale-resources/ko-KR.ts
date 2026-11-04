export const loadResource = (fileNamespace: string) =>
  import(`../locales/ko-KR/${fileNamespace}.json`)
