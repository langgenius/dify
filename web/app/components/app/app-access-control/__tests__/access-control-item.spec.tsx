import { fireEvent, render, screen } from '@testing-library/react'
import useAccessControlStore from '@/context/access-control-store'
import { AccessMode } from '@/models/access-control'
import AccessControlItem from '../access-control-item'

describe('AccessControlItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAccessControlStore.setState({
      appId: '',
      specificGroups: [],
      specificMembers: [],
      currentMenu: AccessMode.PUBLIC,
      selectedGroupsForBreadcrumb: [],
    })
  })

  it('should update current menu when selecting a different access type', () => {
    render(
      <AccessControlItem type={AccessMode.ORGANIZATION}>
        <span>Organization Only</span>
      </AccessControlItem>,
    )

    const option = screen.getByText('Organization Only').parentElement as HTMLElement
    fireEvent.click(option)

    expect(useAccessControlStore.getState().currentMenu).toBe(AccessMode.ORGANIZATION)
  })

  it('should keep the selected state for the active access type', () => {
    useAccessControlStore.setState({
      currentMenu: AccessMode.ORGANIZATION,
    })

    render(
      <AccessControlItem type={AccessMode.ORGANIZATION}>
        <span>Organization Only</span>
      </AccessControlItem>,
    )

    const option = screen.getByText('Organization Only').parentElement as HTMLElement
    expect(option).toHaveClass('border-components-option-card-option-selected-border')
  })
})
