import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { SiteInfo } from '@/models/share'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import WorkflowContent from '../workflow-content'

vi.mock('@/app/components/base/chat/chat/answer/human-input-filled-form-list', () => ({
  default: ({ humanInputFilledFormDataList }: { humanInputFilledFormDataList: Array<unknown> }) => (
    <div>{`filled-forms:${humanInputFilledFormDataList.length}`}</div>
  ),
}))

vi.mock('@/app/components/base/chat/chat/answer/human-input-form-list', () => ({
  default: ({
    humanInputFormDataList,
    onHumanInputFormSubmit,
  }: {
    humanInputFormDataList: Array<unknown>
    onHumanInputFormSubmit: (formToken: string, formData: { inputs: Record<string, string>, action: string }) => void
  }) => (
    <button onClick={() => onHumanInputFormSubmit('token-1', { action: 'submit', inputs: { city: 'Paris' } })}>
      {`human-forms:${humanInputFormDataList.length}`}
    </button>
  ),
}))

vi.mock('@/app/components/base/chat/chat/answer/workflow-process', () => ({
  default: ({
    readonly,
  }: {
    readonly: boolean
  }) => <div>{`workflow-process:${String(readonly)}`}</div>,
}))

vi.mock('../result-tab', () => ({
  default: ({
    currentTab,
    content,
  }: {
    currentTab: string
    content: unknown
  }) => <div>{`result-tab:${currentTab}:${String(content)}`}</div>,
}))

const createWorkflowProcessData = () => ({
  status: WorkflowRunningStatus.Succeeded,
  tracing: [],
  expand: true,
  files: [{ list: [{ id: 'file-1' }], varName: 'documents' }],
  humanInputFilledFormDataList: [{ id: 'filled-1' }],
  humanInputFormDataList: [{ id: 'form-1' }],
  resultText: 'Workflow result',
}) as unknown as WorkflowProcess

const workflowSiteInfo: SiteInfo = {
  title: 'App site',
  show_workflow_steps: false,
}

describe('WorkflowContent', () => {
  it('should render workflow metadata, result tabs, and forward human input submissions', async () => {
    const user = userEvent.setup()
    const onSubmitHumanInputForm = vi.fn()
    const onSwitchTab = vi.fn()

    render(
      <WorkflowContent
        content="workflow-json"
        currentTab="RESULT"
        isError={false}
        onSubmitHumanInputForm={onSubmitHumanInputForm}
        onSwitchTab={onSwitchTab}
        siteInfo={workflowSiteInfo}
        taskId="task-1"
        workflowProcessData={createWorkflowProcessData()}
      />,
    )

    expect(screen.getByText('share.generation.execution')).toBeInTheDocument()
    expect(screen.getByText('task-1')).toBeInTheDocument()
    expect(screen.getByText('workflow-process:true')).toBeInTheDocument()
    expect(screen.getByText('runLog.result')).toBeInTheDocument()
    expect(screen.getByText('runLog.detail')).toBeInTheDocument()
    expect(screen.getByText('human-forms:1')).toBeInTheDocument()
    expect(screen.getByText('filled-forms:1')).toBeInTheDocument()
    expect(screen.getByText('result-tab:RESULT:workflow-json')).toBeInTheDocument()

    await user.click(screen.getByText('runLog.detail'))
    await user.click(screen.getByText('human-forms:1'))

    expect(onSwitchTab).toHaveBeenCalledWith('DETAIL')
    expect(onSubmitHumanInputForm).toHaveBeenCalledWith('token-1', {
      action: 'submit',
      inputs: { city: 'Paris' },
    })
  })

  it('should hide result tabs and content helpers when the workflow is in an error state', () => {
    render(
      <WorkflowContent
        content="workflow-json"
        currentTab="RESULT"
        isError={true}
        onSubmitHumanInputForm={vi.fn()}
        onSwitchTab={vi.fn()}
        siteInfo={null}
        workflowProcessData={{
          expand: false,
          status: WorkflowRunningStatus.Succeeded,
          tracing: [],
        }}
      />,
    )

    expect(screen.queryByText('runLog.result')).not.toBeInTheDocument()
    expect(screen.queryByText(/result-tab:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/workflow-process:/)).not.toBeInTheDocument()
  })

  it('should switch back to the result tab when the detail tab is active', async () => {
    const user = userEvent.setup()
    const onSwitchTab = vi.fn()

    render(
      <WorkflowContent
        content="workflow-json"
        currentTab="DETAIL"
        isError={false}
        onSubmitHumanInputForm={vi.fn()}
        onSwitchTab={onSwitchTab}
        siteInfo={null}
        workflowProcessData={createWorkflowProcessData()}
      />,
    )

    await user.click(screen.getByText('runLog.result'))

    expect(onSwitchTab).toHaveBeenCalledWith('RESULT')
  })
})
