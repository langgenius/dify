import { render, screen } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { describe, expect, it, vi } from 'vitest'
import { DeployDrawer } from '../index'
import { deployDrawerAppInstanceIdAtom, deployDrawerOpenAtom } from '../state'

vi.mock('../ui/form', () => ({
  DeployForm: () => <div data-testid="deploy-form" />,
}))

describe('DeployDrawer', () => {
  it('uses the full-height right drawer layout', () => {
    const store = createStore()
    store.set(deployDrawerOpenAtom, true)
    store.set(deployDrawerAppInstanceIdAtom, 'app-instance-1')

    render(
      <JotaiProvider store={store}>
        <DeployDrawer />
      </JotaiProvider>,
    )

    const drawer = screen.getByRole('dialog')

    expect(screen.getByTestId('deploy-form')).toBeInTheDocument()
    expect(drawer).toHaveClass('data-[swipe-direction=right]:w-[640px]')
    expect(drawer).not.toHaveClass('data-[swipe-direction=right]:top-2')
    expect(drawer).not.toHaveClass('data-[swipe-direction=right]:right-2')
    expect(drawer).not.toHaveClass('data-[swipe-direction=right]:bottom-2')
    expect(drawer).not.toHaveClass('data-[swipe-direction=right]:h-auto')
    expect(drawer).not.toHaveClass('data-[swipe-direction=right]:rounded-xl')
  })
})
