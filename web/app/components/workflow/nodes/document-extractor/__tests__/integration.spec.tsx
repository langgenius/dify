import type { ReactNode } from 'react'
import type { DocExtractorNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguagesSupported } from '@/i18n-config/language'
import { BlockEnum } from '../../../types'
import Node from '../node'
import Panel from '../panel'
import useConfig from '../use-config'

let mockLocale = 'en-US'

vi.mock('reactflow', async () => {
  const actual = await vi.importActual<typeof import('reactflow')>('reactflow')
  return {
    ...actual,
    useNodes: () => [
      {
        id: 'node-1',
        data: {
          title: 'Input Files',
          type: BlockEnum.Start,
        },
      },
    ],
  }
})

vi.mock('@/app/components/workflow/nodes/_base/components/variable/variable-label', () => ({
  VariableLabelInNode: ({
    variables,
    nodeTitle,
    nodeType,
  }: {
    variables: string[]
    nodeTitle?: string
    nodeType?: BlockEnum
  }) => <div>{`${nodeTitle}:${nodeType}:${variables.join('.')}`}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/field', () => ({
  __esModule: true,
  default: ({ title, children }: { title: ReactNode, children: ReactNode }) => (
    <div>
      <div>{title}</div>
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  VarItem: ({ name, type }: { name: string, type: string }) => <div>{`${name}:${type}`}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/split', () => ({
  __esModule: true,
  default: () => <div>split</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  __esModule: true,
  default: ({
    onChange,
  }: {
    onChange: (value: string[]) => void
  }) => <button type="button" onClick={() => onChange(['node-1', 'files'])}>pick-file-var</button>,
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-help-link', () => ({
  useNodeHelpLink: () => 'https://docs.example.com/document-extractor',
}))

vi.mock('@/service/use-common', () => ({
  useFileSupportTypes: () => ({
    data: {
      allowed_extensions: ['PDF', 'md', 'md', 'DOCX'],
    },
  }),
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => mockLocale,
}))

vi.mock('../use-config', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockUseConfig = vi.mocked(useConfig)

const createData = (overrides: Partial<DocExtractorNodeType> = {}): DocExtractorNodeType => ({
  title: 'Document Extractor',
  desc: '',
  type: BlockEnum.DocExtractor,
  variable_selector: ['node-1', 'files'],
  is_array_file: false,
  ...overrides,
})

const createConfigResult = (overrides: Partial<ReturnType<typeof useConfig>> = {}): ReturnType<typeof useConfig> => ({
  readOnly: false,
  inputs: createData(),
  handleVarChanges: vi.fn(),
  filterVar: () => true,
  ...overrides,
})

const panelProps: PanelProps = {
  getInputVars: vi.fn(() => []),
  toVarInputs: vi.fn(() => []),
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: vi.fn(),
  runResult: null,
}

describe('document-extractor path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocale = 'en-US'
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  it('should render nothing when the node input variable is not configured', () => {
    const { container } = render(
      <Node
        id="doc-node"
        data={createData({
          variable_selector: [],
        })}
      />,
    )

    expect(container)!.toBeEmptyDOMElement()
  })

  it('should render the selected input variable on the node', () => {
    render(
      <Node
        id="doc-node"
        data={createData()}
      />,
    )

    expect(screen.getByText('workflow.nodes.docExtractor.inputVar'))!.toBeInTheDocument()
    expect(screen.getByText('Input Files:start:node-1.files'))!.toBeInTheDocument()
  })

  it('should wire panel input changes and format supported file types for english locales', async () => {
    const user = userEvent.setup()
    const handleVarChanges = vi.fn()

    mockUseConfig.mockReturnValueOnce(createConfigResult({
      inputs: createData({
        is_array_file: false,
      }),
      handleVarChanges,
    }))

    render(
      <Panel
        id="doc-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'pick-file-var' }))

    expect(handleVarChanges).toHaveBeenCalledWith(['node-1', 'files'])
    expect(screen.getByText('workflow.nodes.docExtractor.supportFileTypes:{"types":"pdf, markdown, docx"}'))!.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'workflow.nodes.docExtractor.learnMore' }))!.toHaveAttribute(
      'href',
      'https://docs.example.com/document-extractor',
    )
    expect(screen.getByText('text:string'))!.toBeInTheDocument()
  })

  it('should use chinese separators and array output types when the input is an array of files', () => {
    mockLocale = LanguagesSupported[1]!
    mockUseConfig.mockReturnValueOnce(createConfigResult({
      inputs: createData({
        is_array_file: true,
      }),
    }))

    render(
      <Panel
        id="doc-node"
        data={createData({
          is_array_file: true,
        })}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('workflow.nodes.docExtractor.supportFileTypes:{"types":"pdf、 markdown、 docx"}'))!.toBeInTheDocument()
    expect(screen.getByText('text:array[string]'))!.toBeInTheDocument()
  })
})
