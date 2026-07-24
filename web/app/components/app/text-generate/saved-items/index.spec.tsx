import type { ISavedItemsProps } from './index'
import { fireEvent, render, screen } from '@testing-library/react'
import copy from 'copy-to-clipboard'

import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '@/app/components/base/toast'
import SavedItems from './index'

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '/',
}))

const mockCopy = vi.mocked(copy)
const toastNotifySpy = vi.spyOn(Toast, 'notify')

const baseProps: ISavedItemsProps = {
  list: [
    { id: '1', answer: 'hello world' },
  ],
  isShowTextToSpeech: true,
  onRemove: vi.fn(),
  onStartCreateContent: vi.fn(),
}

describe('SavedItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toastNotifySpy.mockClear()
  })

  it('renders saved answers with metadata and controls', () => {
    const { container } = render(<SavedItems {...baseProps} />)

    const markdownElement = container.querySelector('.markdown-body')
    expect(markdownElement).toBeInTheDocument()
    expect(screen.getByText('11 common.unit.char')).toBeInTheDocument()

    const actionArea = container.querySelector('[class*="bg-components-actionbar-bg"]')
    const actionButtons = actionArea?.querySelectorAll('button') ?? []
    expect(actionButtons.length).toBeGreaterThanOrEqual(3)
  })

  it('copies content and notifies, and triggers remove callback', () => {
    const handleRemove = vi.fn()
    const { container } = render(<SavedItems {...baseProps} onRemove={handleRemove} />)

    const actionArea = container.querySelector('[class*="bg-components-actionbar-bg"]')
    const actionButtons = actionArea?.querySelectorAll('button') ?? []
    expect(actionButtons.length).toBeGreaterThanOrEqual(3)

    const copyButton = actionButtons[1]
    const deleteButton = actionButtons[2]

    fireEvent.click(copyButton)
    expect(mockCopy).toHaveBeenCalledWith('hello world')
    expect(toastNotifySpy).toHaveBeenCalledWith({ type: 'success', message: 'common.actionMsg.copySuccessfully' })

    fireEvent.click(deleteButton)
    expect(handleRemove).toHaveBeenCalledWith('1')
  })
})
