import type { ReactElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import NodeSearchButton from '../node-search-button'

const { mockOpenGotoAnythingDialog } = vi.hoisted(() => ({
  mockOpenGotoAnythingDialog: vi.fn(),
}))

vi.mock('@/app/components/goto-anything/dialog-handle', () => ({
  openGotoAnythingDialog: mockOpenGotoAnythingDialog,
}))

vi.mock('../../operator/tip-popup', () => ({
  default: ({ children }: { children: ReactElement }) => children,
}))

describe('NodeSearchButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the workflow node search scope from the header', () => {
    render(<NodeSearchButton />)

    fireEvent.click(screen.getByRole('button'))

    expect(mockOpenGotoAnythingDialog).toHaveBeenCalledWith('@node ')
  })
})
