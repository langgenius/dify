import type { ComponentType } from 'react'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { Theme } from '@/types/app'
import { BlockEnum } from '../../types'
import ToolBrowser from '../tool-browser'
import { createToolProvider } from './factories'

const moduleReady = vi.hoisted(() => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
})

// Delay delivery at the framework boundary while keeping the real list and loader.
vi.mock('next/dynamic', async (importOriginal) => {
  const { default: dynamic } = await importOriginal<typeof import('next/dynamic')>()
  return {
    default: <P extends object>(
      loader: () => Promise<{ default: ComponentType<P> }>,
      options: Parameters<typeof dynamic<P>>[1],
    ) => dynamic(() => moduleReady.promise.then(loader), options),
  }
})

vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'zh_Hans',
}))

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: Theme.light }),
}))

vi.mock('@/app/components/plugins/marketplace/query', () => ({
  useMarketplacePlugins: () => ({ data: undefined, isFetching: false }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/mcp-tool-availability', () => ({
  useMCPToolAvailability: () => ({ allowed: true }),
}))

it('keeps filters usable while loading and selects from the latest filtered list', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  const props = {
    tags: [],
    onSelect,
    buildInTools: [
      createToolProvider({
        id: 'chinese',
        label: { en_US: 'Chinese Provider', zh_Hans: '中文工具' },
      }),
      createToolProvider({
        id: 'other',
        label: { en_US: 'Other Provider', zh_Hans: 'Other Provider' },
      }),
    ],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  }
  const { rerender } = renderWithConsoleQuery(<ToolBrowser {...props} searchText="" />, {
    systemFeatures: { enable_marketplace: false },
  })

  try {
    expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
    expect(screen.queryByText('中文工具')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'workflow.tabs.plugin' }))
    expect(screen.getByRole('button', { name: 'workflow.tabs.plugin' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    rerender(<ToolBrowser {...props} searchText="中文" />)

    await act(async () => moduleReady.resolve())

    expect(await screen.findByText('中文工具')).toBeInTheDocument()
    expect(screen.queryByText('Other Provider')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Tool A' }))
    expect(onSelect).toHaveBeenCalledWith(
      BlockEnum.Tool,
      expect.objectContaining({ provider_id: 'chinese', tool_name: 'tool-a' }),
    )
  } finally {
    moduleReady.resolve()
  }
})
