const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('@/next/navigation', () => ({
  notFound: () => mocks.notFound(),
}))

describe('DeploymentsLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should always trigger notFound', async () => {
    const { default: DeploymentsLayout } = await import('../layout')

    expect(() => DeploymentsLayout()).toThrow('NEXT_NOT_FOUND')

    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })
})
