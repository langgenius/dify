import type { ContextGenerateResponse } from '@/contract/console/generator'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import RightPanel from '../right-panel'

vi.mock('@/app/components/base/action-button', () => ({
  default: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, disabled }: { children: React.ReactNode, onClick?: () => void, disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>{children}</button>
  ),
}))

vi.mock('@/app/components/base/copy-feedback', () => ({
  CopyFeedbackNew: ({ content }: { content: string }) => <div data-testid="copy-feedback">{content}</div>,
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading" />,
}))

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({
    children,
    onOpenChange,
  }: {
    children: React.ReactNode
    onOpenChange?: (open: boolean) => void
  }) => (
    <div>
      <button type="button" onClick={() => onOpenChange?.(true)}>portal-open</button>
      <button type="button" onClick={() => onOpenChange?.(false)}>portal-close</button>
      {children}
    </div>
  ),
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) =>
    React.isValidElement(children)
      ? React.cloneElement(children, { onClick } as Record<string, unknown>)
      : <div onClick={onClick}>{children}</div>,
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value, language }: { value: unknown, language: string }) => (
    <div data-testid={`code-editor-${language}`}>{typeof value === 'string' ? value : JSON.stringify(value)}</div>
  ),
}))

const defaultVersion: ContextGenerateResponse = {
  variables: [{ variable: 'result', value_selector: ['result'] }],
  outputs: { result: { type: 'string' } },
  code_language: CodeLanguage.javascript,
  code: 'return input',
  message: '',
  error: '',
}

const renderRightPanel = (overrides: Partial<React.ComponentProps<typeof RightPanel>> = {}) => {
  const props: React.ComponentProps<typeof RightPanel> = {
    isInitView: false,
    isGenerating: false,
    displayVersion: defaultVersion,
    displayCodeLanguage: CodeLanguage.javascript,
    displayOutputData: { variables: defaultVersion.variables, outputs: defaultVersion.outputs },
    rightContainerRef: { current: null },
    resolvedCodePanelHeight: 220,
    onResizeStart: vi.fn(),
    versionOptions: [{ index: 0, label: 'Version 1' }, { index: 1, label: 'Version 2' }],
    currentVersionIndex: 0,
    currentVersionLabel: 'Version 1',
    onSelectVersion: vi.fn(),
    onRun: vi.fn(),
    onApply: vi.fn(),
    canRun: true,
    canApply: true,
    isRunning: false,
    onClose: vi.fn(),
    ...overrides,
  }

  return {
    ...render(<RightPanel {...props} />),
    props,
  }
}

describe('RightPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the empty placeholder while the init view is active', () => {
    renderRightPanel({
      isInitView: true,
      displayVersion: null,
      displayOutputData: null,
      versionOptions: [],
      currentVersionLabel: '',
    })

    expect(screen.getByText('workflow.nodes.tool.contextGenerate.rightSidePlaceholder')).toBeInTheDocument()
  })

  it('should allow selecting versions and invoke run, apply, close, and resize actions', () => {
    const { props } = renderRightPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Version 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.tool.contextGenerate.run' }))
    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.tool.contextGenerate.apply' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'workflow.nodes.tool.contextGenerate.resizeHandle' }))

    expect(props.onSelectVersion).toHaveBeenCalledWith(1)
    expect(props.onRun).toHaveBeenCalledTimes(1)
    expect(props.onApply).toHaveBeenCalledTimes(1)
    expect(props.onResizeStart).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('code-editor-javascript')).toHaveTextContent('return input')
    expect(screen.getByTestId('code-editor-json')).toHaveTextContent('"result"')
  })

  it('should show a running badge instead of the run button when execution is in progress', () => {
    renderRightPanel({
      isRunning: true,
    })

    expect(screen.getByText('workflow.nodes.tool.contextGenerate.running')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'workflow.nodes.tool.contextGenerate.run' })).not.toBeInTheDocument()
  })

  it('should render loading and close actions in init mode before any version is available', () => {
    const { props } = renderRightPanel({
      isInitView: true,
      isGenerating: true,
      displayVersion: null,
      displayOutputData: null,
      versionOptions: [{ index: 0, label: 'Version 1' }],
    })

    fireEvent.click(screen.getAllByRole('button')[0]!)

    expect(screen.getByTestId('loading')).toBeInTheDocument()
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('should toggle the version menu only when multiple versions exist and use fallback code/output values', () => {
    renderRightPanel({
      displayVersion: {
        ...defaultVersion,
        code: '',
      },
      displayOutputData: null,
      versionOptions: [{ index: 0, label: 'Version 1' }],
    })

    fireEvent.click(screen.getByRole('button', { name: 'portal-open' }))
    fireEvent.click(screen.getAllByText('Version 1')[1]!)
    fireEvent.click(screen.getByRole('button', { name: 'portal-close' }))

    expect(screen.queryByTestId('code-editor-javascript')).toHaveTextContent('')
    expect(screen.getByTestId('code-editor-json')).toHaveTextContent('"variables":[]')
    expect(screen.queryByText('Version 2')).not.toBeInTheDocument()
  })

  it('should open and toggle the version menu when multiple versions exist', () => {
    const { props } = renderRightPanel()

    fireEvent.click(screen.getByRole('button', { name: 'portal-open' }))
    fireEvent.click(screen.getAllByText('Version 1')[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Version 2' }))

    expect(props.onSelectVersion).toHaveBeenCalledWith(1)
  })
})
