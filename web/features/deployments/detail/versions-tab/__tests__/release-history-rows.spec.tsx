import type { ReleaseWithSummaryDeployments } from '../release-deployments'
import { ReleaseSource, RuntimeInstanceStatus } from '@dify/contracts/enterprise/types.gen'
import { render, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReleaseHistoryRows } from '../release-history-rows'

vi.mock('../deploy-release-menu', () => ({
  DeployReleaseMenu: () => <button type="button">Actions</button>,
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()

  return {
    ...actual,
    useQuery: () => ({
      data: {
        name: 'Source Workflow',
      },
    }),
  }
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    apps: {
      byAppId: {
        get: {
          queryOptions: (options: unknown) => options,
        },
      },
    },
  },
}))

function createReleaseRow(overrides: Partial<ReleaseWithSummaryDeployments> = {}): ReleaseWithSummaryDeployments {
  return {
    id: 'release-1',
    appInstanceId: 'app-instance-1',
    displayName: 'Initial Release',
    description: '',
    source: ReleaseSource.RELEASE_SOURCE_UPLOAD,
    gateCommitId: '2f414f18abcdef',
    requiredSlots: [],
    createdBy: {
      id: 'account-1',
      displayName: 'Dify Admin',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    summaryDeployments: [],
    ...overrides,
  } as ReleaseWithSummaryDeployments
}

function requireElement<T extends Element>(element: T | null, label: string): T {
  expect(element).not.toBeNull()
  if (!element)
    throw new Error(`${label} should exist`)
  return element
}

describe('ReleaseHistoryRows', () => {
  it('should render the desktop release list with the knowledge table style', () => {
    const { container } = render(
      <ReleaseHistoryRows
        releaseRows={[createReleaseRow()]}
      />,
    )

    const table = requireElement(container.querySelector('table'), 'release table')
    const tableScope = within(table)
    const header = requireElement(table.querySelector('thead'), 'release table header')
    const headerCell = requireElement(table.querySelector('th'), 'release table header cell')
    const bodyRow = requireElement(table.querySelector('tbody tr'), 'release table row')

    expect(table).toHaveClass('w-full', 'border-collapse', 'border-0', 'text-sm')
    expect(header).toHaveClass('border-b', 'border-divider-subtle')
    expect(headerCell).not.toHaveClass('bg-background-section-burn', 'rounded-l-lg')
    expect(bodyRow).toHaveClass('h-8', 'border-b', 'border-divider-subtle', 'hover:bg-background-default-hover')
    expect(tableScope.getByText('Initial Release')).toBeInTheDocument()
  })

  it('should render release deployments with the dot status style', () => {
    const { container } = render(
      <ReleaseHistoryRows
        releaseRows={[
          createReleaseRow({
            summaryDeployments: [{
              environmentId: 'env-1',
              environmentName: 'test-cpu',
              status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY,
            }],
          }),
        ]}
      />,
    )

    const table = requireElement(container.querySelector('table'), 'release table')
    const deploymentLabel = requireElement(table.querySelector('.text-util-colors-green-green-600'), 'deployment label')

    expect(deploymentLabel).toHaveTextContent('test-cpu')
    expect(deploymentLabel).toHaveClass('text-util-colors-green-green-600', 'system-xs-medium')
    expect(deploymentLabel).not.toHaveClass('border', 'rounded-md', 'bg-util-colors-green-green-50')
    expect(deploymentLabel).not.toHaveAttribute('data-base-ui-tooltip-trigger')
    expect(container.querySelector('.shadow-status-indicator-green-shadow')).toBeInTheDocument()
  })

  it('should render release source app links with scoped source app state', () => {
    const { container } = render(
      <ReleaseHistoryRows
        releaseRows={[
          createReleaseRow({
            sourceAppId: 'source-app-1',
          }),
        ]}
      />,
    )

    const table = requireElement(container.querySelector('table'), 'release table')
    const sourceLink = within(table).getByRole('link', { name: /Source Workflow/ })

    expect(sourceLink).toHaveAttribute('href', '/app/source-app-1/workflow')
    expect(sourceLink).toHaveAttribute('target', '_blank')
  })
})
