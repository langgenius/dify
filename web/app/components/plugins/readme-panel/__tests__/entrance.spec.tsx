import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { createPluginDetail } from '../../plugin-detail-panel/__tests__/endpoint-fixture'
import { ReadmeEntrance } from '../entrance'

describe('ReadmeEntrance admission', () => {
  it('does not offer a Readme for a built-in tool', () => {
    render(<ReadmeEntrance pluginDetail={{ ...createPluginDetail(), id: 'code' }} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('does not offer a Readme without a plugin identifier', () => {
    render(
      <ReadmeEntrance pluginDetail={{ ...createPluginDetail(), plugin_unique_identifier: '' }} />,
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
