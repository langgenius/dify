import type { ComponentType } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRAGRecommendedPlugins } from '@/service/use-tools'
import { Theme } from '@/types/app'
import { RAGToolRecommendations } from '..'
import { BlockEnum } from '../../../types'
import { createToolProvider } from '../../__tests__/factories'
import { ViewType } from '../../types'

const moduleReady = vi.hoisted(() => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
})

// Delay delivery at the framework boundary while keeping the real list and loader.
vi.mock('@/next/dynamic', async (importOriginal) => {
  const { default: dynamic } = await importOriginal<typeof import('@/next/dynamic')>()
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

vi.mock('@/service/use-tools', () => ({
  useRAGRecommendedPlugins: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/mcp-tool-availability', () => ({
  useMCPToolAvailability: () => ({ allowed: true }),
}))

it('can collapse while recommendations load, then reopen and select an installed tool', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  localStorage.setItem('workflow_rag_recommendations_collapsed', 'true')
  vi.mocked(useRAGRecommendedPlugins, { partial: true }).mockReturnValue({
    data: {
      installed_recommended_plugins: [
        createToolProvider({ label: { en_US: 'Chinese Provider', zh_Hans: '中文工具' } }),
      ],
      uninstalled_recommended_plugins: [],
    },
    isLoading: false,
    isFetching: false,
  })

  render(
    <RAGToolRecommendations viewType={ViewType.flat} onSelect={onSelect} onLoadMore={vi.fn()} />,
  )

  try {
    const toggle = screen.getByRole('button', { name: 'pipeline.ragToolSuggestions.title' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

    await user.click(toggle)
    expect(screen.getByRole('progressbar', { name: 'appApi.loading' })).toBeInTheDocument()
    expect(screen.queryByText('中文工具')).not.toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    await act(async () => {
      moduleReady.resolve()
      await vi.dynamicImportSettled()
    })
    expect(screen.queryByText('中文工具')).not.toBeInTheDocument()

    await user.click(toggle)
    await user.click(await screen.findByRole('button', { name: /中文工具/ }))
    await user.click(screen.getByRole('button', { name: 'Tool A' }))

    expect(onSelect).toHaveBeenCalledWith(
      BlockEnum.Tool,
      expect.objectContaining({ provider_id: 'provider-1', tool_name: 'tool-a' }),
    )
  } finally {
    moduleReady.resolve()
  }
})
