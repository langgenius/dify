import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import PluginAuthInDataSourceNode from '../plugin-auth-in-datasource-node'

describe('PluginAuthInDataSourceNode', () => {
  it('offers navigation to connect while hiding authorized content', async () => {
    const user = userEvent.setup()
    const onJump = vi.fn()
    render(
      <PluginAuthInDataSourceNode onJumpToDataSourcePage={onJump}>
        Data Source Connected
      </PluginAuthInDataSourceNode>,
    )
    expect(screen.queryByText('Data Source Connected')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.integrations.connect' }))

    expect(onJump).toHaveBeenCalledOnce()
  })

  it('replaces the connect action with authorized content', () => {
    render(
      <PluginAuthInDataSourceNode isAuthorized onJumpToDataSourcePage={vi.fn()}>
        Data Source Connected
      </PluginAuthInDataSourceNode>,
    )

    expect(
      screen.queryByRole('button', { name: 'common.integrations.connect' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Data Source Connected')).toBeInTheDocument()
  })
})
