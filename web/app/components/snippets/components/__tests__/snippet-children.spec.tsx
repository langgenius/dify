import type { ComponentProps } from 'react'
import type SnippetHeader from '../snippet-header'
import type SnippetWorkflowPanel from '../workflow-panel'
import type { SnippetInputField } from '@/models/snippet'
import { render, screen } from '@testing-library/react'
import { PipelineInputVarType } from '@/models/pipeline'
import SnippetChildren from '../snippet-children'

let capturedHeaderProps: ComponentProps<typeof SnippetHeader> | undefined
let capturedWorkflowPanelProps: ComponentProps<typeof SnippetWorkflowPanel> | undefined

vi.mock('../snippet-header', () => ({
  default: (props: ComponentProps<typeof SnippetHeader>) => {
    capturedHeaderProps = props
    return <div data-testid="snippet-header" />
  },
}))

vi.mock('../workflow-panel', () => ({
  default: (props: ComponentProps<typeof SnippetWorkflowPanel>) => {
    capturedWorkflowPanelProps = props
    return <div data-testid="snippet-workflow-panel" />
  },
}))

const fields: SnippetInputField[] = [
  {
    label: 'Topic',
    variable: 'topic',
    type: PipelineInputVarType.textInput,
    required: true,
  },
]

describe('SnippetChildren', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedHeaderProps = undefined
    capturedWorkflowPanelProps = undefined
  })

  it('should render snippet header and workflow panel with forwarded props', () => {
    const callbacks = {
      onPublish: vi.fn(),
    }

    render(
      <SnippetChildren
        snippetId="snippet-1"
        fields={fields}
        canSave
        canEdit
        isPublishing={false}
        {...callbacks}
      />,
    )

    expect(screen.getByTestId('snippet-header')).toBeInTheDocument()
    expect(screen.getByTestId('snippet-workflow-panel')).toBeInTheDocument()
    expect(capturedHeaderProps).toEqual(expect.objectContaining({
      snippetId: 'snippet-1',
      canSave: true,
      canEdit: true,
      isPublishing: false,
      ...callbacks,
    }))
    expect(capturedWorkflowPanelProps).toEqual({
      snippetId: 'snippet-1',
      fields,
    })
  })
})
