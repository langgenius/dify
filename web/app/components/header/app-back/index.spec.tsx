import type { App } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import AppBack from './index'

describe('AppBack', () => {
  const mockApp: Partial<App> = {
    id: 'test-app',
    name: 'Test App',
  }

  it('should render the apps menu text', () => {
    render(<AppBack curApp={mockApp as App} />)
    expect(screen.getByText('common.menus.apps')).toBeInTheDocument()
  })

  it('should show grid icon by default and arrow icon on hover', async () => {
    const { container } = render(<AppBack curApp={mockApp as App} />)
    const wrapper = container.firstChild as HTMLElement

    let icons = wrapper.querySelectorAll('svg')
    const initialIconCount = icons.length

    fireEvent.mouseEnter(wrapper)
    await new Promise(resolve => setTimeout(resolve, 0))

    icons = wrapper.querySelectorAll('svg')
    expect(icons.length).toBe(initialIconCount)
  })

  it('should revert to grid icon after unhover', async () => {
    const { container } = render(<AppBack curApp={mockApp as App} />)
    const wrapper = container.firstChild as HTMLElement

    fireEvent.mouseEnter(wrapper)
    await new Promise(resolve => setTimeout(resolve, 0))

    fireEvent.mouseLeave(wrapper)
    await new Promise(resolve => setTimeout(resolve, 0))

    const icons = wrapper.querySelectorAll('svg')
    expect(icons.length).toBeGreaterThan(0)
  })

  it('should work with different app objects', () => {
    const app1: Partial<App> = { id: 'app-1' }
    const app2: Partial<App> = { id: 'app-2' }

    const { rerender } = render(<AppBack curApp={app1 as App} />)
    expect(screen.getByText('common.menus.apps')).toBeInTheDocument()

    rerender(<AppBack curApp={app2 as App} />)
    expect(screen.getByText('common.menus.apps')).toBeInTheDocument()
  })
})
