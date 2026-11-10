import type { ResolvedTheme } from '@/features/theme/theme'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { WorkflowRunTriggeredFrom } from '@/models/log'
import TriggerByDisplay from '../trigger-by-display'

let theme: ResolvedTheme = 'light'

vi.mock('@/features/theme/hooks', () => ({
  useResolvedTheme: () => theme,
}))
vi.mock('@/app/components/workflow/block-icon', () => ({
  default: ({ toolIcon }: { toolIcon?: string }) => (
    <img alt={toolIcon ? 'Plugin trigger icon' : 'Default plugin trigger icon'} src={toolIcon} />
  ),
}))

describe('TriggerByDisplay', () => {
  beforeEach(() => {
    theme = 'light'
  })

  it.each([
    [WorkflowRunTriggeredFrom.APP_RUN, 'appLog.triggerBy.appRun'],
    [WorkflowRunTriggeredFrom.DEBUGGING, 'appLog.triggerBy.debugging'],
    [WorkflowRunTriggeredFrom.WEBHOOK, 'appLog.triggerBy.webhook'],
    [WorkflowRunTriggeredFrom.SCHEDULE, 'appLog.triggerBy.schedule'],
    [WorkflowRunTriggeredFrom.PLUGIN, 'appLog.triggerBy.plugin'],
    [WorkflowRunTriggeredFrom.RAG_PIPELINE_RUN, 'appLog.triggerBy.ragPipelineRun'],
    [WorkflowRunTriggeredFrom.RAG_PIPELINE_DEBUGGING, 'appLog.triggerBy.ragPipelineDebugging'],
  ])('labels the %s trigger source', (triggeredFrom, label) => {
    render(<TriggerByDisplay triggeredFrom={triggeredFrom} />)

    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('uses plugin event metadata as the visible trigger name', () => {
    render(
      <TriggerByDisplay
        triggeredFrom={WorkflowRunTriggeredFrom.PLUGIN}
        triggerMetadata={{ event_name: 'Issue created' }}
      />,
    )

    expect(screen.getByText('Issue created')).toBeInTheDocument()
  })

  it('uses the theme-specific plugin icon when available', () => {
    theme = 'dark'
    render(
      <TriggerByDisplay
        triggeredFrom={WorkflowRunTriggeredFrom.PLUGIN}
        triggerMetadata={{ icon: 'light.svg', icon_dark: 'dark.svg' }}
      />,
    )

    expect(screen.getByRole('img', { name: 'Plugin trigger icon' })).toHaveAttribute(
      'src',
      'dark.svg',
    )
  })
})
