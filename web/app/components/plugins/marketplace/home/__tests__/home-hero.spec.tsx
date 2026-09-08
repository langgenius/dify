import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HERO_GRID_PITCH_PX, HERO_ICON_SIZE_PX } from '../home-constants'
import HomeHero from '../home-hero'

vi.mock('#i18n', async () => {
  const { withSelectorKey } = await import('@/test/i18n-mock')
  return {
    useTranslation: () => ({
      t: withSelectorKey((key: string) => key),
    }),
  }
})

describe('HomeHero', () => {
  it('renders catalog-specific copy when supplied', () => {
    render(
      <HomeHero
        isMarketplacePlatform
        title="Discover templates"
        subtitle="Start faster with ready-to-use workflows."
      />,
    )

    expect(screen.getByRole('heading', { name: 'Discover templates' })).toBeInTheDocument()
    expect(screen.getByText('Start faster with ready-to-use workflows.')).toBeInTheDocument()
    expect(screen.queryByText('marketplace.home.heroTitle')).not.toBeInTheDocument()
  })

  it('renders the six decorative hero icons as images instead of iconify masks', () => {
    const { container } = render(<HomeHero isMarketplacePlatform />)

    for (const name of [
      'sparkling-fill',
      'plug-fill',
      'puzzle-fill',
      'brain-2-fill',
      'image-circle-ai-line',
      'voice-ai-fill',
    ])
      expect(container.querySelector(`img[src*="${name}"]`)).not.toBeNull()

    expect(container.querySelector('img[src*="google"]')).toBeNull()
    expect(container.querySelector('.i-ri-sparkling-fill')).toBeNull()
    expect(container.querySelector('.i-custom-public-common-gmail')).toBeNull()
  })

  it('places each decorative icon flush inside a 41px grid cell', () => {
    expect(HERO_ICON_SIZE_PX).toBe(HERO_GRID_PITCH_PX - 1)

    const { container } = render(<HomeHero isMarketplacePlatform />)
    const icons = [...container.querySelectorAll<HTMLElement>('[aria-hidden] span.absolute')]
    expect(icons).toHaveLength(6)

    const plusOffset = /^calc\(50% \+ (-?\d+)px\)$/
    const minusOffset = /^calc\(50% - (\d+)px\)$/

    for (const icon of icons) {
      const plusMatch = plusOffset.exec(icon.style.left)
      const minusMatch = minusOffset.exec(icon.style.left)
      const left = plusMatch
        ? Number(plusMatch[1])
        : minusMatch
          ? -Number(minusMatch[1])
          : Number.NaN
      const top = Number.parseFloat(icon.style.top)

      expect(left).not.toBeNaN()
      expect((left - 1) % HERO_GRID_PITCH_PX === 0).toBe(true)
      expect(top % HERO_GRID_PITCH_PX === 0).toBe(true)
    }
  })

  it('starts vertical grid lines on the same 50% origin as the icons', () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../home-hero.module.css'),
      'utf8',
    )

    expect(css).toMatch(/background-position:\s*calc\(50% \+ 0\.5px\)/)
    expect(css).toMatch(/\.frame\s*\{\s*height:\s*163px/)
    expect(css).toMatch(/\.glow\s*\{[\s\S]*?width:\s*555px/)
    expect(css).toMatch(/\.glow\s*\{[\s\S]*?height:\s*245px/)
    expect(css).toMatch(/\.glow\s*\{[\s\S]*?filter:\s*blur\(30px\)/)
  })
})
