import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import NoDataPlaceholder from '../no-data-placeholder'

describe('NoDataPlaceholder', () => {
  it('renders the no-found state by default', () => {
    const { container } = render(<NoDataPlaceholder className="min-h-10" />)

    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByText('plugin.autoUpdate.noPluginPlaceholder.noFound')).toBeInTheDocument()
  })

  it('renders the no-installed state when noPlugins is true', () => {
    const { container } = render(<NoDataPlaceholder className="min-h-10" noPlugins />)

    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByText('plugin.autoUpdate.noPluginPlaceholder.noInstalled')).toBeInTheDocument()
  })
})
