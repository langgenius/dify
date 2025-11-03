export const isTokenV1 = (token: Record<string, any>) => {
  return !token.version
}

export const getInitialTokenV2 = (): Record<string, any> => ({
  version: 2,
})
