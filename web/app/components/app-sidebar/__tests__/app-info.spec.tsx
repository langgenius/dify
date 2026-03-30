import { render, screen } from '@testing-library/react'
import AppInfo from '../app-info'

vi.mock('../app-info/index', () => ({
  default: ({
    expand,
    onlyShowDetail = false,
    openState = false,
  }: {
    expand: boolean
    onlyShowDetail?: boolean
    openState?: boolean
  }) => (
    <div
      data-testid="app-info-inner"
      data-expand={String(expand)}
      data-only-show-detail={String(onlyShowDetail)}
      data-open-state={String(openState)}
    />
  ),
}))

describe('app-sidebar/app-info entrypoint', () => {
  it('should forward props to the modular app-info implementation', () => {
    render(<AppInfo expand onlyShowDetail openState />)

    expect(screen.getByTestId('app-info-inner')).toHaveAttribute('data-expand', 'true')
    expect(screen.getByTestId('app-info-inner')).toHaveAttribute('data-only-show-detail', 'true')
    expect(screen.getByTestId('app-info-inner')).toHaveAttribute('data-open-state', 'true')
  })
})
