type DeploymentCase = {
  edition: 'CLOUD' | 'SELF_HOSTED'
  enterpriseEnabled: boolean
  expected: {
    isCloud: boolean
    isCommunity: boolean
    isSelfHosted: boolean
  }
}

const loadConfig = async ({ edition, enterpriseEnabled }: DeploymentCase) => {
  vi.resetModules()
  vi.doMock('@/env', () => ({
    env: {
      NEXT_PUBLIC_EDITION: edition,
      NEXT_PUBLIC_ENTERPRISE_ENABLED: enterpriseEnabled,
    },
  }))

  return import('../index')
}

describe('deployment edition config', () => {
  afterEach(() => {
    vi.doUnmock('@/env')
    vi.resetModules()
  })

  it.each<DeploymentCase>([
    {
      edition: 'CLOUD',
      enterpriseEnabled: false,
      expected: { isCloud: true, isCommunity: false, isSelfHosted: false },
    },
    {
      edition: 'CLOUD',
      enterpriseEnabled: true,
      expected: { isCloud: true, isCommunity: false, isSelfHosted: false },
    },
    {
      edition: 'SELF_HOSTED',
      enterpriseEnabled: false,
      expected: { isCloud: false, isCommunity: true, isSelfHosted: true },
    },
    {
      edition: 'SELF_HOSTED',
      enterpriseEnabled: true,
      expected: { isCloud: false, isCommunity: false, isSelfHosted: true },
    },
  ])('derives flags for $edition with enterpriseEnabled=$enterpriseEnabled', async (deployment) => {
    const config = await loadConfig(deployment)

    expect({
      isCloud: config.IS_CLOUD_EDITION,
      isCommunity: config.IS_COMMUNITY_EDITION,
      isSelfHosted: config.IS_CE_EDITION,
    }).toEqual(deployment.expected)
  })
})
