import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider as JotaiProvider } from 'jotai'
import { describe, expect, it, vi } from 'vite-plus/test'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import PluginTypeSwitch from '../plugin-type-switch'

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({ t: withSelectorKey((key: string) => key) }),
  }
})

const renderSwitch = (searchParams = '') => {
  const { wrapper: NuqsWrapper, onUrlUpdate } = createNuqsTestWrapper({ searchParams })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <JotaiProvider>
      <NuqsWrapper>{children}</NuqsWrapper>
    </JotaiProvider>
  )

  return { ...render(<PluginTypeSwitch />, { wrapper: Wrapper }), onUrlUpdate }
}

describe('PluginTypeSwitch', () => {
  it('renders every supported plugin category', () => {
    renderSwitch()

    expect(screen.getByRole('button', { name: 'category.all' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'category.models' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'category.tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'category.datasources' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'category.agents' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'category.triggers' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'category.extensions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'category.bundles' })).toBeInTheDocument()
  })

  it('updates the category in the URL when selected', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderSwitch('?category=all')

    const modelsButton = screen.getByRole('button', { name: 'category.models' })
    modelsButton.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('category')).toBe('model')
    expect(modelsButton).toHaveAttribute('aria-pressed', 'true')
  })
})
