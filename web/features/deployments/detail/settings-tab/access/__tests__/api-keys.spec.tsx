import type { DeveloperApiKeyRow } from '@dify/contracts/enterprise/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiKeyList } from '../api-keys'

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      appDeployAccessService: {
        deleteDeveloperApiKey: {
          mutationOptions: () => ({ mutationFn: vi.fn() }),
        },
      },
    },
  },
}))

function apiKey(overrides: Partial<DeveloperApiKeyRow> = {}): DeveloperApiKeyRow {
  return {
    id: 'key-1',
    name: 'production-key-001',
    environment: { id: 'env-1', name: 'production' },
    maskedKey: 'app-****-abcd',
    ...overrides,
  }
}

function renderApiKeyList(apiKeys: DeveloperApiKeyRow[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ApiKeyList appInstanceId="instance-1" apiKeys={apiKeys} />
    </QueryClientProvider>,
  )
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
})
