import type { TriggerMetadata } from '@/models/log'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowRunTriggeredFrom } from '@/models/log'
import { Theme } from '@/types/app'
import TriggerByDisplay from '../trigger-by-display'

let theme = Theme.light

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme }),
}))
vi.mock('@/app/components/workflow/block-icon', () => ({
  default: ({ toolIcon }: { toolIcon?: string }) => (
    <img alt={toolIcon ? 'Plugin trigger icon' : 'Default plugin trigger icon'} src={toolIcon} />
  ),
}))

describe('TriggerByDisplay', () => {
  beforeEach(() => {
    theme = Theme.light
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
        triggerMetadata={{ event_name: 'Issue created' } as TriggerMetadata}
      />,
    )

    expect(screen.getByText('Issue created')).toBeInTheDocument()
  })

  it('uses the theme-specific plugin icon when available', () => {
    theme = Theme.dark
    render(
      <TriggerByDisplay
        triggeredFrom={WorkflowRunTriggeredFrom.PLUGIN}
        triggerMetadata={{ icon: 'light.svg', icon_dark: 'dark.svg' } as TriggerMetadata}
      />,
    )

    expect(screen.getByRole('img', { name: 'Plugin trigger icon' })).toHaveAttribute(
      'src',
      'dark.svg',
    )
  })

  it('can render an icon-only trigger label', () => {
    render(<TriggerByDisplay triggeredFrom={WorkflowRunTriggeredFrom.PLUGIN} showText={false} />)

    expect(screen.queryByText('appLog.triggerBy.plugin')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Default plugin trigger icon' })).toBeInTheDocument()
  })
})
