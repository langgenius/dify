import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AppInfoHeader from '../app-info-header'

describe('AppInfoHeader', () => {
  it('keeps the two-line header and menu trigger while details become available', async () => {
    const onEdit = vi.fn()
    const view = render(<AppInfoHeader expand appName="App" operationGroups={[]} />)
    const trigger = screen.getByRole('button')
    const header = view.container.firstElementChild
    const icon = view.container.querySelector('[class~="group/app-icon"]')
    const subtitle = header?.lastElementChild?.lastElementChild
    expect(trigger).toBeDisabled()
    expect(icon).toHaveClass('h-9', 'w-9', 'rounded-full')
    expect(subtitle).toBeEmptyDOMElement()
    expect(subtitle).toHaveClass('min-h-3')

    view.rerender(
      <AppInfoHeader
        expand
        appName="My workflow"
        modeLabel="Workflow"
        operationGroups={[[{ id: 'edit', title: 'Edit', icon: 'i-ri-edit-line', onClick: onEdit }]]}
      />,
    )
    expect(view.container.firstElementChild).toBe(header)
    expect(screen.getByText('Workflow')).toBe(subtitle)
    expect(screen.getByRole('button')).toBe(trigger)
    expect(trigger).toBeEnabled()
    await userEvent.setup().click(trigger)
    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalledOnce()
  })
})
