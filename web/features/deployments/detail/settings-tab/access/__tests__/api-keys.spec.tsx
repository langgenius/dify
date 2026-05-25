import type { ApiKey } from '@dify/contracts/enterprise/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiKeyList } from '../api-keys'

const mocks = vi.hoisted(() => ({
  deleteApiKey: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mocks.toastError(...args),
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
  },
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      accessService: {
        deleteApiKey: {
          mutationOptions: () => ({ mutationFn: mocks.deleteApiKey }),
        },
        listApiKeys: {
          key: ({ input }: { input?: { params?: { appInstanceId?: string, environmentId?: string } } } = {}) => [
            'console',
            'enterprise',
            'accessService',
            'listApiKeys',
            input?.params?.appInstanceId,
            input?.params?.environmentId,
          ],
        },
      },
    },
  },
}))

function apiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key-1',
    appInstanceId: 'instance-1',
    name: 'production-key-001',
    environmentId: 'env-1',
    maskedToken: 'app-****-abcd',
    ...overrides,
  }
}

function renderApiKeyList(apiKeys: ApiKey[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  const renderResult = render(
    <QueryClientProvider client={queryClient}>
      <ApiKeyList
        apiKeys={apiKeys}
        environments={[{ id: 'env-1', name: 'production' }]}
      />
    </QueryClientProvider>,
  )

  return {
    ...renderResult,
    queryClient,
  }
}

describe('ApiKeyList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // API keys should match the shared semantic table shell used by deployment detail tabs.
  describe('Rendering', () => {
    it('should render API keys with the shared detail table design', () => {
      // Arrange & Act
      const { container } = renderApiKeyList([apiKey()])

      // Assert
      const desktopWrapper = container.querySelector('.hidden.pc\\:block')
      const tableContainer = desktopWrapper?.querySelector('[data-slot="deployment-detail-table-container"]')
      const tableShell = desktopWrapper?.querySelector('[data-slot="deployment-detail-table"]')
      const header = tableShell?.querySelector('[data-slot="deployment-detail-table-header"]')
      const body = tableShell?.querySelector('[data-slot="deployment-detail-table-body"]')
      const row = body?.querySelector('[data-slot="deployment-detail-table-row"]')
      const head = header?.querySelector('[data-slot="deployment-detail-table-head"]')
      const cell = row?.querySelector('[data-slot="deployment-detail-table-cell"]')

      expect(tableContainer).toHaveClass(
        'relative',
        'w-full',
        'overflow-x-auto',
      )
      expect(tableShell?.tagName).toBe('TABLE')
      expect(header?.tagName).toBe('THEAD')
      expect(body?.tagName).toBe('TBODY')
      expect(row?.tagName).toBe('TR')
      expect(head?.tagName).toBe('TH')
      expect(cell?.tagName).toBe('TD')
      expect(tableShell).toHaveClass(
        'w-full',
        'max-w-full',
        'min-w-[700px]',
        'border-collapse',
        'border-0',
        'caption-bottom',
        'text-sm',
      )
      expect(header).toHaveClass(
        'h-8',
        'border-b',
        'border-divider-subtle',
        'text-xs/8',
        'font-medium',
        'text-text-tertiary',
        'uppercase',
      )
      expect(head).toHaveClass(
        'max-w-[200px]',
        'px-2.5',
        'py-0',
        'pl-3',
        'font-medium',
        'whitespace-nowrap',
        'text-text-tertiary',
      )
      expect(body).toHaveClass('text-text-secondary')
      expect(row).toHaveClass(
        'h-8',
        'border-b',
        'border-divider-subtle',
        'hover:bg-background-default-hover',
      )
      expect(cell).toHaveClass(
        'max-w-[200px]',
        'px-2.5',
        'py-[5px]',
        'pl-3',
        'align-middle',
      )
      expect(row?.querySelector('[data-slot="deployment-detail-table-row-content"]')).toBeNull()
      expect(screen.getAllByLabelText('deployments.access.revoke')).toHaveLength(2)
    })
  })

  // Revoking a key should show in-row progress and refresh the query-backed list when it succeeds.
  describe('Revoke action', () => {
    it('should show loading state, refresh API keys, and notify success when revoking an API key', async () => {
      // Arrange
      let resolveDeleteApiKey: () => void = () => undefined
      mocks.deleteApiKey.mockReturnValue(new Promise<void>((resolve) => {
        resolveDeleteApiKey = resolve
      }))
      const { queryClient } = renderApiKeyList([apiKey()])
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
      const revokeButton = screen.getAllByLabelText('deployments.access.revoke')[0]!

      // Act
      fireEvent.click(revokeButton)

      // Assert
      await waitFor(() => {
        expect(revokeButton).toBeDisabled()
        expect(revokeButton).toHaveAttribute('aria-busy', 'true')
      })
      expect(mocks.deleteApiKey).toHaveBeenCalledWith({
        params: {
          apiKeyId: 'key-1',
        },
      }, expect.anything())

      await act(async () => {
        resolveDeleteApiKey()
      })

      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['console', 'enterprise', 'accessService', 'listApiKeys', 'instance-1', 'env-1'],
        })
        expect(mocks.toastSuccess).toHaveBeenCalledWith('deployments.access.api.revokeSuccess')
      })
    })
  })
})
