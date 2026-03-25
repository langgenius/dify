import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { UserActionButtonType } from '../../types'
import FormContentPreview from '../form-content-preview'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockUseStore = vi.hoisted(() => vi.fn())
const mockUseNodes = vi.hoisted(() => vi.fn())
const mockGetButtonStyle = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { panelWidth: number }) => unknown) => mockUseStore(selector),
}))

vi.mock('@/app/components/workflow/store/workflow/use-nodes', () => ({
  __esModule: true,
  default: () => mockUseNodes(),
}))

vi.mock('@/app/components/base/action-button', () => ({
  __esModule: true,
  default: ({ children, onClick }: { children?: ReactNode, onClick?: () => void }) => (
    <button type="button" aria-label="close-preview" onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/app/components/base/badge', () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div data-testid="badge">{children}</div>,
}))

vi.mock('@/app/components/base/button', () => ({
  __esModule: true,
  default: ({ children, variant }: { children?: ReactNode, variant?: string }) => (
    <button type="button" data-testid={`action-${variant}`}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/chat/chat/answer/human-input-content/utils', () => ({
  getButtonStyle: (...args: unknown[]) => mockGetButtonStyle(...args),
}))

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ customComponents }: {
    customComponents: {
      variable: (props: { node: { properties: { dataPath: string } } }) => ReactNode
      section: (props: { node: { properties: { dataName: string } } }) => ReactNode
    }
  }) => (
    <div>
      {customComponents.variable({ node: { properties: { dataPath: '#node-1.answer#' } } })}
      {customComponents.section({ node: { properties: { dataName: 'field_1' } } })}
      {customComponents.section({ node: { properties: { dataName: 'missing_field' } } })}
    </div>
  ),
}))

vi.mock('../variable-in-markdown', () => ({
  rehypeNotes: vi.fn(),
  rehypeVariable: vi.fn(),
  Variable: ({ path }: { path: string }) => <div data-testid="variable-path">{path}</div>,
  Note: ({ defaultInput, nodeName }: {
    defaultInput: { selector: string[] }
    nodeName: (nodeId: string) => string
  }) => <div data-testid="note">{nodeName(defaultInput.selector[0])}</div>,
}))

describe('FormContentPreview', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTranslation.mockReturnValue({
      t: (key: string) => key,
    })
    mockUseStore.mockImplementation((selector: (state: { panelWidth: number }) => unknown) => selector({ panelWidth: 320 }))
    mockUseNodes.mockReturnValue([{
      id: 'node-1',
      data: { title: 'Classifier' },
    }])
    mockGetButtonStyle.mockImplementation((style: UserActionButtonType) => style.toLowerCase())
  })

  it('should render preview content with resolved node names, note fallbacks, and action buttons', () => {
    const { container } = render(
      <FormContentPreview
        content="content"
        formInputs={[{
          type: 'text-input' as never,
          output_variable_name: 'field_1',
          default: {
            type: 'variable',
            selector: ['node-1', 'answer'],
            value: '',
          },
        }]}
        userActions={[{
          id: 'approve',
          title: 'Approve',
          button_style: UserActionButtonType.Primary,
        }]}
        onClose={onClose}
      />,
    )

    expect(container.firstChild).toHaveStyle({ right: '328px' })
    expect(screen.getByTestId('badge')).toHaveTextContent('nodes.humanInput.formContent.preview')
    expect(screen.getByTestId('variable-path')).toHaveTextContent('#Classifier.answer#')
    expect(screen.getByTestId('note')).toHaveTextContent('Classifier')
    expect(screen.getByText(/Can't find note:/)).toHaveTextContent('missing_field')
    expect(screen.getByTestId('action-primary')).toHaveTextContent('Approve')
    expect(screen.getByText('nodes.humanInput.editor.previewTip')).toBeInTheDocument()
  })

  it('should close the preview when the close action is clicked', () => {
    render(
      <FormContentPreview
        content="content"
        formInputs={[]}
        userActions={[]}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'close-preview' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
