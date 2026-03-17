const { mockInit, varState } = vi.hoisted(() => ({
  mockInit: vi.fn(),
  varState: {
    basePath: '',
  },
}))

vi.mock('@/utils/var', () => ({
  get basePath() {
    return varState.basePath
  },
}))

vi.mock('modern-monaco', () => ({
  init: mockInit,
}))

describe('initMonaco', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    varState.basePath = ''
    mockInit.mockResolvedValue({ editor: 'mock-editor' })
  })

  it('should initialize modern monaco with hoisted asset paths', async () => {
    varState.basePath = '/console'

    const mod = await import('./init')
    const result = await mod.initMonaco()

    expect(mockInit).toHaveBeenCalledTimes(1)
    expect(mockInit).toHaveBeenCalledWith({
      defaultTheme: '/console/hoisted-modern-monaco/tm-themes@1.12.1/themes/dark-plus.json',
      themes: [
        '/console/hoisted-modern-monaco/tm-themes@1.12.1/themes/light-plus.json',
        '/console/hoisted-modern-monaco/tm-themes@1.12.1/themes/dark-plus.json',
      ],
      langs: [
        '/console/hoisted-modern-monaco/tm-grammars@1.31.2/grammars/javascript.json',
        '/console/hoisted-modern-monaco/tm-grammars@1.31.2/grammars/json.json',
        '/console/hoisted-modern-monaco/tm-grammars@1.31.2/grammars/python.json',
        '/console/hoisted-modern-monaco/tm-grammars@1.31.2/grammars/html.json',
        '/console/hoisted-modern-monaco/tm-grammars@1.31.2/grammars/css.json',
      ],
    })
    expect(result).toEqual({ editor: 'mock-editor' })
  })

  it('should reuse the initialized promise on subsequent calls', async () => {
    const mod = await import('./init')

    const first = await mod.initMonaco()
    const second = await mod.initMonaco()

    expect(mockInit).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
  })
})
