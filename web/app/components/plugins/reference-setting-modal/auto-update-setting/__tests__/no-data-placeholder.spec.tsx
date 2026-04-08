import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NoDataPlaceholder from '../no-data-placeholder'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('@/app/components/base/icons/src/vender/line/general', () => ({
  SearchMenu: ({ className }: { className?: string }) => <div data-testid="search-icon" className={className}>search-icon</div>,
}))

vi.mock('@/app/components/base/icons/src/vender/other', () => ({
  Group: ({ className }: { className?: string }) => <div data-testid="group-icon" className={className}>group-icon</div>,
}))

describe('NoDataPlaceholder', () => {
  it('renders the no-found state by default', () => {
    render(<NoDataPlaceholder className="min-h-10" />)

    expect(screen.getByTestId('search-icon')).toBeInTheDocument()
    expect(screen.getByText('plugin.autoUpdate.noPluginPlaceholder.noFound')).toBeInTheDocument()
  })

  it('renders the no-installed state when noPlugins is true', () => {
    render(<NoDataPlaceholder className="min-h-10" noPlugins />)

    expect(screen.getByTestId('group-icon')).toBeInTheDocument()
    expect(screen.getByText('plugin.autoUpdate.noPluginPlaceholder.noInstalled')).toBeInTheDocument()
  })
})
