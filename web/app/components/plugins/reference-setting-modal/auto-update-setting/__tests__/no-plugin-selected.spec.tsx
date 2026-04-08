import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NoPluginSelected from '../no-plugin-selected'
import { AUTO_UPDATE_MODE } from '../types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

describe('NoPluginSelected', () => {
  it('renders partial mode placeholder', () => {
    render(<NoPluginSelected updateMode={AUTO_UPDATE_MODE.partial} />)

    expect(screen.getByText('plugin.autoUpdate.upgradeModePlaceholder.partial')).toBeInTheDocument()
  })

  it('renders exclude mode placeholder', () => {
    render(<NoPluginSelected updateMode={AUTO_UPDATE_MODE.exclude} />)

    expect(screen.getByText('plugin.autoUpdate.upgradeModePlaceholder.exclude')).toBeInTheDocument()
  })
})
