import { createNodeCrudModuleMock, createUuidModuleMock } from './use-config-test-utils'

describe('use-config-test-utils', () => {
  it('createUuidModuleMock should return stable ids from the provided factory', () => {
    const mockUuid = vi.fn(() => 'generated-id')
    const moduleMock = createUuidModuleMock(mockUuid)

    expect(moduleMock.v4()).toBe('generated-id')
    expect(mockUuid).toHaveBeenCalledTimes(1)
  })

  it('createNodeCrudModuleMock should expose inputs and setInputs through the default export', () => {
    const setInputs = vi.fn()
    const payload = { title: 'Node', type: 'code' }
    const moduleMock = createNodeCrudModuleMock<typeof payload>(setInputs)

    const result = moduleMock.default('node-1', payload)

    expect(moduleMock.__esModule).toBe(true)
    expect(result.inputs).toBe(payload)
    result.setInputs({ next: true })
    expect(setInputs).toHaveBeenCalledWith({ next: true })
  })
})
