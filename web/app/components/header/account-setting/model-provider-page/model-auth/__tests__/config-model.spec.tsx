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
  ])('marks the loading $name action as unavailable', ({ name, props }) => {
    render(<ConfigModel {...props} loading />)

    const action = screen.getByRole('button', { name })
    expect(action).not.toHaveAttribute('aria-busy')
    expect(action).toHaveAttribute('aria-disabled', 'true')
  })
})
