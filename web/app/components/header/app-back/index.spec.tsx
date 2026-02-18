import type { App } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import AppBack from './index'

describe('AppBack', () => {
  const mockApp = {
    id: 'test-app',
    name: 'Test App',
  } as App

  it('should render apps label', () => {
    render(<AppBack curApp={mockApp} />)
    expect(screen.getByText('common.menus.apps')).toBeInTheDocument()
  })

  it('should keep apps label visible while hovering', () => {
    render(<AppBack curApp={mockApp} />)
    const label = screen.getByText('common.menus.apps')

    fireEvent.mouseEnter(label)
    expect(label).toBeInTheDocument()
    fireEvent.mouseLeave(label)
    expect(label).toBeInTheDocument()
  })

  it('should render with different apps', () => {
    const app1 = { id: 'app-1' } as App
    const app2 = { id: 'app-2' } as App

    const { rerender } = render(<AppBack curApp={app1} />)
    expect(screen.getByText('common.menus.apps')).toBeInTheDocument()

    rerender(<AppBack curApp={app2} />)
    expect(screen.getByText('common.menus.apps')).toBeInTheDocument()
  })
})
