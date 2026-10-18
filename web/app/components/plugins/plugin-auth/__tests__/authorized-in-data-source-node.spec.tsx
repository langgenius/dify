import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import AuthorizedInDataSourceNode from '../authorized-in-data-source-node'

describe('AuthorizedInDataSourceNode', () => {
  it.each([
    [1, 'plugin.auth.authorization'],
    [3, 'plugin.auth.authorizations'],
  ] as const)('opens datasource settings with %s authorizations', async (count, name) => {
    const user = userEvent.setup()
    const onJump = vi.fn()
    render(<AuthorizedInDataSourceNode authorizationsNum={count} onJumpToDataSourcePage={onJump} />)

    await user.click(screen.getByRole('button', { name }))

    expect(onJump).toHaveBeenCalledOnce()
  })
})
