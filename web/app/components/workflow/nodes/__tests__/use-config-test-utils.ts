export const createUuidModuleMock = (getId: () => string) => ({
  v4: () => getId(),
})
