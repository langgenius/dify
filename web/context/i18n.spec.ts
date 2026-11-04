import type { DocPathMap } from './i18n'
import type { DocPathWithoutLang } from '@/types/doc-paths'
import { useLocale } from '#i18n'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import { defaultDocBaseUrl, enterpriseDocBaseUrl, useDocLink } from './i18n'

const mockDeploymentEdition = vi.hoisted(() => ({
  value: 'CLOUD' as 'COMMUNITY' | 'ENTERPRISE' | 'CLOUD',
}))

// Mock dependencies
vi.mock('#i18n', () => ({
  useLocale: vi.fn(() => 'en-US'),
}))

const renderHook = (callback: () => ReturnType<typeof useDocLink>) =>
  renderHookWithConsoleQuery(callback, {
    systemFeatures: { deployment_edition: mockDeploymentEdition.value },
  })

describe('useDocLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeploymentEdition.value = 'CLOUD'
    vi.mocked(useLocale).mockReturnValue('en-US')
  })

  describe('Base URL handling', () => {
    it('should use default base URL when no baseUrl provided', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current()
      expect(url).toBe(`${defaultDocBaseUrl}/en/home`)
    })

    it('should use custom base URL when provided', () => {
      const customBaseUrl = 'https://custom.docs.com'
      const { result } = renderHook(() => useDocLink(customBaseUrl))
      const url = result.current()
      expect(url).toBe(`${customBaseUrl}/en/home`)
    })

    it('should remove trailing slash from base URL', () => {
      const baseUrlWithSlash = 'https://docs.dify.ai/'
      const { result } = renderHook(() => useDocLink(baseUrlWithSlash))
      const url = result.current('/use-dify/getting-started/introduction')
      expect(url).toBe('https://docs.dify.ai/en/cloud/use-dify/getting-started/introduction')
    })
  })

  describe('Path handling', () => {
    it('should handle path parameter', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/getting-started/introduction')
      expect(url).toBe(`${defaultDocBaseUrl}/en/cloud/use-dify/getting-started/introduction`)
    })

    it('should keep common docs path without product prefix', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current('/learn/key-concepts' as DocPathWithoutLang)
      expect(url).toBe(`${defaultDocBaseUrl}/en/learn/key-concepts`)
    })

    it('should keep explicit product docs path without adding another product prefix', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current(
        '/cloud/use-dify/getting-started/introduction' as DocPathWithoutLang,
      )
      expect(url).toBe(`${defaultDocBaseUrl}/en/cloud/use-dify/getting-started/introduction`)
    })
  })

  describe('PathMap handling', () => {
    it('should use path from pathMap when locale matches', () => {
      vi.mocked(useLocale).mockReturnValue('zh-Hans')

      const pathMap: DocPathMap = {
        'zh-Hans': '/use-dify/getting-started/introduction',
        'en-US': '/use-dify/workspace/tools#mcp',
      }

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/workspace/tools#mcp', pathMap)
      expect(url).toBe(`${defaultDocBaseUrl}/zh/cloud/use-dify/getting-started/introduction`)
    })

    it('should use default path when locale not in pathMap', () => {
      vi.mocked(useLocale).mockReturnValue('ja-JP')

      const pathMap: DocPathMap = {
        'zh-Hans': '/use-dify/getting-started/introduction',
        'en-US': '/use-dify/workspace/tools#mcp',
      }

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/workspace/tools#mcp', pathMap)
      expect(url).toBe(`${defaultDocBaseUrl}/ja/cloud/use-dify/workspace/tools#mcp`)
    })
  })

  describe('Product prefix handling', () => {
    it.each([
      ['CLOUD', 'cloud'],
      ['COMMUNITY', 'self-host'],
    ] as const)(
      'should route New Agent docs in %s edition to %s product docs',
      (deploymentEdition, docsProduct) => {
        mockDeploymentEdition.value = deploymentEdition

        const { result } = renderHook(() => useDocLink())

        expect(result.current('/use-dify/build/new-agent/overview')).toBe(
          `${defaultDocBaseUrl}/en/${docsProduct}/use-dify/build/new-agent/overview`,
        )
        expect(result.current('/use-dify/build/new-agent/build#prompt')).toBe(
          `${defaultDocBaseUrl}/en/${docsProduct}/use-dify/build/new-agent/build#prompt`,
        )
      },
    )

    it('should add cloud product prefix for product docs available in both editions', () => {
      mockDeploymentEdition.value = 'CLOUD'

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/workspace/tools#mcp')
      expect(url).toBe(`${defaultDocBaseUrl}/en/cloud/use-dify/workspace/tools#mcp`)
    })

    it('should add self-host product prefix for product docs available in both editions outside cloud edition', () => {
      mockDeploymentEdition.value = 'COMMUNITY'

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/workspace/tools#mcp')
      expect(url).toBe(`${defaultDocBaseUrl}/en/self-host/use-dify/workspace/tools#mcp`)
    })

    it('should use the existing cloud docs path for cloud-only product docs outside cloud edition', () => {
      mockDeploymentEdition.value = 'COMMUNITY'

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/workspace/subscription-management#dify-for-education')
      expect(url).toBe(
        `${defaultDocBaseUrl}/en/cloud/use-dify/workspace/subscription-management#dify-for-education`,
      )
    })

    it('should use the self-host Start node docs path outside cloud edition', () => {
      mockDeploymentEdition.value = 'COMMUNITY'

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/nodes/start')
      expect(url).toBe(`${defaultDocBaseUrl}/en/self-host/use-dify/nodes/start`)
    })

    it('should use the existing self-host docs path for self-host-only product docs in cloud edition', () => {
      mockDeploymentEdition.value = 'CLOUD'

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/deploy/overview')
      expect(url).toBe(`${defaultDocBaseUrl}/en/self-host/deploy/overview`)
    })

    it('should not add a product prefix for unknown productless paths', () => {
      mockDeploymentEdition.value = 'COMMUNITY'

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/unknown-page' as DocPathWithoutLang)
      expect(url).toBe(`${defaultDocBaseUrl}/en/use-dify/unknown-page`)
    })

    it('should open shared docs home when no path is provided outside cloud edition', () => {
      mockDeploymentEdition.value = 'COMMUNITY'

      const { result } = renderHook(() => useDocLink())
      const url = result.current()
      expect(url).toBe(`${defaultDocBaseUrl}/en/home`)
    })

    it('should keep self-host deploy paths without adding use-dify product prefix', () => {
      mockDeploymentEdition.value = 'CLOUD'

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/self-host/deploy/overview' as DocPathWithoutLang)
      expect(url).toBe(`${defaultDocBaseUrl}/en/self-host/deploy/overview`)
    })
  })

  describe('Enterprise documentation', () => {
    beforeEach(() => {
      mockDeploymentEdition.value = 'ENTERPRISE'
    })

    it('should route use documentation to the versioned enterprise documentation', () => {
      const { result } = renderHook(() => useDocLink())

      expect(result.current('/use-dify/build/workflow-chatflow')).toBe(
        `${enterpriseDocBaseUrl}/en/use/build/workflow-chatflow`,
      )
    })

    it.each([
      ['/use-dify/getting-started/introduction', '/use/build/workflow-chatflow'],
      ['/cli/overview', '/develop/cli/introduction'],
      ['/cli/authenticate', '/develop/cli/account-users/authenticate'],
      ['/cli/common-tasks', '/develop/cli/account-users/common-tasks'],
      ['/cli/quick-start', '/develop/cli/account-users/quick-start'],
    ] as const)('should map the renamed %s page to %s', (communityPath, enterprisePath) => {
      const { result } = renderHook(() => useDocLink())

      expect(result.current(communityPath)).toBe(`${enterpriseDocBaseUrl}/en${enterprisePath}`)
    })

    it('should convert API, plugin, and CLI documentation prefixes', () => {
      const { result } = renderHook(() => useDocLink())

      expect(result.current('/api-reference/guides/knowledge')).toBe(
        `${enterpriseDocBaseUrl}/en/develop/api/guides/knowledge`,
      )
      expect(result.current('/develop-plugin/getting-started/getting-started-dify-plugin')).toBe(
        `${enterpriseDocBaseUrl}/en/develop/plugins/getting-started/getting-started-dify-plugin`,
      )
      expect(result.current('/cli/install')).toBe(`${enterpriseDocBaseUrl}/en/develop/cli/install`)
    })

    it('should remove public product prefixes and preserve anchors', () => {
      const { result } = renderHook(() => useDocLink())

      expect(result.current('/self-host/use-dify/workspace/tools#mcp' as DocPathWithoutLang)).toBe(
        `${enterpriseDocBaseUrl}/en/use/workspace/tools#mcp`,
      )
      expect(result.current('/cloud/use-dify/nodes/start' as DocPathWithoutLang)).toBe(
        `${enterpriseDocBaseUrl}/en/use/nodes/start`,
      )
    })

    it.each(['/cloud', '/self-host'] as const)(
      'should map the bare %s product prefix to the enterprise documentation home',
      (productPrefix) => {
        const { result } = renderHook(() => useDocLink())

        expect(result.current(productPrefix as DocPathWithoutLang)).toBe(
          `${enterpriseDocBaseUrl}/en/`,
        )
      },
    )

    it.each([
      '/use-dify/knowledge/knowledge-request-rate-limit',
      '/cloud/use-dify/knowledge/knowledge-storage-limit',
      '/cloud/use-dify/workspace/subscription-management#dify-for-education',
    ] as const)('should fall back to the enterprise documentation home for %s', (communityPath) => {
      const { result } = renderHook(() => useDocLink())

      expect(result.current(communityPath)).toBe(`${enterpriseDocBaseUrl}/en/`)
    })

    it('should open the enterprise documentation home when no path is provided', () => {
      const { result } = renderHook(() => useDocLink())

      expect(result.current()).toBe(`${enterpriseDocBaseUrl}/en/`)
    })

    it('should use Chinese and Japanese enterprise documentation languages', () => {
      vi.mocked(useLocale).mockReturnValue('zh-Hans')

      const { result, rerender } = renderHook(() => useDocLink())
      expect(result.current('/use-dify/nodes/start')).toBe(
        `${enterpriseDocBaseUrl}/zh/use/nodes/start`,
      )

      vi.mocked(useLocale).mockReturnValue('ja-JP')
      rerender()

      expect(result.current('/use-dify/nodes/start')).toBe(
        `${enterpriseDocBaseUrl}/ja/use/nodes/start`,
      )
    })
  })

  describe('API reference path handling', () => {
    it('should add language prefix for Chinese API reference paths', () => {
      vi.mocked(useLocale).mockReturnValue('zh-Hans')

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/api-reference/annotations/create-annotation')
      expect(url).toBe(`${defaultDocBaseUrl}/zh/api-reference/annotations/create-annotation`)
    })

    it('should add language prefix for Japanese API reference paths', () => {
      vi.mocked(useLocale).mockReturnValue('ja-JP')

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/api-reference/applications/get-app-info')
      expect(url).toBe(`${defaultDocBaseUrl}/ja/api-reference/applications/get-app-info`)
    })

    it('should not translate API reference path for English locale', () => {
      vi.mocked(useLocale).mockReturnValue('en-US')

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/api-reference/annotations/create-annotation')
      expect(url).toBe(`${defaultDocBaseUrl}/en/api-reference/annotations/create-annotation`)
    })

    it('should use the current knowledge API guide path directly', () => {
      vi.mocked(useLocale).mockReturnValue('zh-Hans')

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/api-reference/guides/knowledge')
      expect(url).toBe(`${defaultDocBaseUrl}/zh/api-reference/guides/knowledge`)
    })

    it('should not translate non-API-reference paths', () => {
      vi.mocked(useLocale).mockReturnValue('zh-Hans')

      const { result } = renderHook(() => useDocLink())
      const url = result.current('/use-dify/getting-started/introduction')
      expect(url).toBe(`${defaultDocBaseUrl}/zh/cloud/use-dify/getting-started/introduction`)
    })
  })

  describe('Edge Cases', () => {
    it('should handle path with anchor', () => {
      const { result } = renderHook(() => useDocLink())
      const url = result.current(
        '/use-dify/getting-started/introduction#overview' as DocPathWithoutLang,
      )
      expect(url).toBe(
        `${defaultDocBaseUrl}/en/cloud/use-dify/getting-started/introduction#overview`,
      )
    })
  })
})
