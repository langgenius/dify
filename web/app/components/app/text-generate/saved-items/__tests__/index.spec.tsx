import type { ISavedItemsProps } from '../index'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import SavedItems from '../index'

const mockCopy = vi.fn()

vi.mock('foxact/use-clipboard', () => ({
  useClipboard: () => ({
    copy: mockCopy,
    copied: false,
  }),
}))
vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '/',
}))

const baseProps: ISavedItemsProps = {
  list: [{ id: '1', answer: 'hello world' }],
  isShowTextToSpeech: true,
  onRemove: vi.fn(),
  onStartCreateContent: vi.fn(),
}

describe('SavedItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders saved answers with metadata and controls', () => {
    const { container } = render(<SavedItems {...baseProps} />)

    const markdownElement = container.querySelector('.markdown-body')
    expect(markdownElement)!.toBeInTheDocument()
    expect(screen.getByText('11 common.unit.char'))!.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'common.operation.copy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.delete' })).toBeInTheDocument()
  })

  it('copies content and triggers remove callback', () => {
    const handleRemove = vi.fn()
    render(<SavedItems {...baseProps} onRemove={handleRemove} />)

    const copyButton = screen.getByRole('button', { name: 'common.operation.copy' })
    const deleteButton = screen.getByRole('button', { name: 'common.operation.delete' })

    fireEvent.click(copyButton)
    expect(mockCopy).toHaveBeenCalledWith('hello world')

    fireEvent.click(deleteButton)
    expect(handleRemove).toHaveBeenCalledWith('1')
  })
})
