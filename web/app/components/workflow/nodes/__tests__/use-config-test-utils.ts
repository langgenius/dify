type SetInputsMock = (value: unknown) => void

export const createUuidModuleMock = (getId: () => string) => ({
  v4: () => getId(),
})

export const createNodeCrudModuleMock = <T>(setInputs: SetInputsMock) => ({
  __esModule: true as const,
  default: (_id: string, data: T) => ({
    inputs: data,
    setInputs,
  }),
})
