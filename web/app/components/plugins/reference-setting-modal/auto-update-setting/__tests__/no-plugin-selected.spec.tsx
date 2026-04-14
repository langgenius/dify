import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import NoPluginSelected from '../no-plugin-selected'
import { AUTO_UPDATE_MODE } from '../types'

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
