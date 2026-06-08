import { fireEvent, render, screen } from '@testing-library/react'
import { AccessMode } from '@/models/access-control'
import { AccessControlItem } from '../access-control-item'
import { AccessControlRadioGroupHarness } from './access-control-radio-group-harness'
import { createAccessControlDraftHarness } from './access-control-test-utils'

describe('AccessControlItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should update current menu when selecting a different access type', () => {
    const harness = createAccessControlDraftHarness(
      <AccessControlRadioGroupHarness>
        <AccessControlItem type={AccessMode.ORGANIZATION}>
          <span>Organization Only</span>
        </AccessControlItem>
      </AccessControlRadioGroupHarness>,
      { currentMenu: AccessMode.PUBLIC },
    )
    render(harness.element)

    const option = screen.getByRole('radio', { name: 'Organization Only' })
    fireEvent.click(option)

    expect(harness.getSnapshot().currentMenu).toBe(AccessMode.ORGANIZATION)
  })

  it('should keep the selected state for the active access type', () => {
    const harness = createAccessControlDraftHarness(
      <AccessControlRadioGroupHarness>
        <AccessControlItem type={AccessMode.ORGANIZATION}>
          <span>Organization Only</span>
        </AccessControlItem>
      </AccessControlRadioGroupHarness>,
      { currentMenu: AccessMode.ORGANIZATION },
    )
    render(harness.element)

    const option = screen.getByRole('radio', { name: 'Organization Only' })
    expect(option).toHaveAttribute('data-checked')
  })
})
