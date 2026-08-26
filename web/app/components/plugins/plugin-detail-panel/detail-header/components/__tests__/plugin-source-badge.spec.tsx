import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { PluginSource } from '../../../../types'
import PluginSourceBadge from '../plugin-source-badge'

describe('PluginSourceBadge', () => {
  it.each([
    [PluginSource.marketplace, 'plugin.detailPanel.categoryTip.marketplace'],
    [PluginSource.github, 'plugin.detailPanel.categoryTip.github'],
    [PluginSource.local, 'plugin.detailPanel.categoryTip.local'],
    [PluginSource.debugging, 'plugin.detailPanel.categoryTip.debugging'],
  ])('labels the %s source badge', (source, label) => {
    render(<PluginSourceBadge source={source} />)

    expect(screen.getByLabelText(label)).toBeInTheDocument()
  })
})
