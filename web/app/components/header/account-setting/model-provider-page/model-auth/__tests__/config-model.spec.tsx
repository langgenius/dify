import { screen } from '@testing-library/react'
import { render } from '@/test/console/render'
import ConfigModel from '../config-model'

describe('ConfigModel', () => {
  it.each([
    {
      name: 'common.operation.config',
      props: {},
    },
    {
      name: 'common.modelProvider.auth.authorizationError',
      props: { loadBalancingInvalid: true },
    },
  ])('keeps the $name action focusable and unavailable while loading', ({ name, props }) => {
    render(<ConfigModel {...props} loading />)

    const action = screen.getByRole('button', { name })
    expect(action).toHaveAttribute('aria-disabled', 'true')
    expect(action).not.toHaveAttribute('aria-busy')
  })
})
