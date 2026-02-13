import type { ChatWithHistoryContextValue } from '../context'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InputVarType } from '@/app/components/workflow/types'
import { useChatWithHistoryContext } from '../context'
import ViewFormDropdown from './view-form-dropdown'

// Mocks for components used by InputsFormContent (the real sibling)
vi.mock('@/app/components/workflow/nodes/_base/components/before-run-form/bool-input', () => ({
  default: ({ value, name }: { value: boolean, name: string }) => (
    <div data-testid="mock-bool-input" role="checkbox" aria-checked={value}>
      {name}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value, placeholder }: { value: string, placeholder?: React.ReactNode }) => (
    <div data-testid="mock-code-editor">
      <span>{value}</span>
      {placeholder}
    </div>
  ),
}))

vi.mock('@/app/components/base/file-uploader', () => ({
  FileUploaderInAttachmentWrapper: ({ value }: { value?: unknown[] }) => (
    <div data-testid="mock-file-uploader" data-count={value?.length ?? 0} />
  ),
}))

vi.mock('../context', () => ({
  useChatWithHistoryContext: vi.fn(),
}))

const defaultContextValues: Partial<ChatWithHistoryContextValue> = {
  inputsForms: [{ variable: 'test_var', type: InputVarType.textInput, label: 'Test Label' }],
  currentConversationInputs: {},
  newConversationInputs: {},
  newConversationInputsRef: { current: {} } as unknown as React.RefObject<Record<string, unknown>>,
  setCurrentConversationInputs: vi.fn(),
  handleNewConversationInputsChange: vi.fn(),
  appParams: { system_parameters: {} } as unknown as ChatWithHistoryContextValue['appParams'],
  allInputsHidden: false,
}

const setMockContext = (overrides: Partial<ChatWithHistoryContextValue> = {}) => {
  vi.mocked(useChatWithHistoryContext).mockReturnValue({
    ...defaultContextValues,
    ...overrides,
  } as unknown as ChatWithHistoryContextValue)
}

describe('ViewFormDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMockContext()
  })

  it('renders the dropdown trigger and toggles content visibility', async () => {
    const user = userEvent.setup()
    render(<ViewFormDropdown />)

    // Initially, settings icon should be hidden (portal content)
    expect(screen.queryByText('share.chat.chatSettingsTitle')).not.toBeInTheDocument()

    // Find trigger (ActionButton renders a button)
    const trigger = screen.getByRole('button')
    expect(trigger).toBeInTheDocument()

    // Open dropdown
    await user.click(trigger)
    expect(screen.getByText('share.chat.chatSettingsTitle')).toBeInTheDocument()
    expect(screen.getByText('Test Label')).toBeInTheDocument()

    // Close dropdown
    await user.click(trigger)
    expect(screen.queryByText('share.chat.chatSettingsTitle')).not.toBeInTheDocument()
  })

  it('renders correctly with multiple form items', async () => {
    setMockContext({
      inputsForms: [
        { variable: 'text', type: InputVarType.textInput, label: 'Text Form' },
        { variable: 'num', type: InputVarType.number, label: 'Num Form' },
      ],
    })

    const user = userEvent.setup()
    render(<ViewFormDropdown />)
    await user.click(screen.getByRole('button'))

    expect(screen.getByText('Text Form')).toBeInTheDocument()
    expect(screen.getByText('Num Form')).toBeInTheDocument()
  })

  it('applies correct state to ActionButton when open', async () => {
    const user = userEvent.setup()
    render(<ViewFormDropdown />)
    const trigger = screen.getByRole('button')

    // closed state
    expect(trigger).not.toHaveClass('action-btn-hover')

    // open state
    await user.click(trigger)
    expect(trigger).toHaveClass('action-btn-hover')
  })
})
