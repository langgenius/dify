import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import HomeSearch from '../home-search'

vi.mock('#i18n', () => ({
  useTranslation: () => ({ t: vi.fn() }),
}))

describe('HomeSearch', () => {
  it('keeps desktop centering in the responsive search content class', () => {
    render(
      <HomeSearch>
        <input aria-label="Marketplace search" />
      </HomeSearch>,
    )

    const content = screen.getByRole('textbox', { name: 'Marketplace search' }).parentElement
    const stickyWrapper = content?.parentElement

    expect(content?.className).toContain('searchContent')
    expect(content).not.toHaveClass('max-w-[420px]')
    expect(stickyWrapper).not.toHaveClass('px-4')
  })
})
