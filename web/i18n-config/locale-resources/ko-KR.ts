export const loadResource = (fileNamespace: string) =>
  import(`../../i18n/ko-KR/${fileNamespace}.json`)
