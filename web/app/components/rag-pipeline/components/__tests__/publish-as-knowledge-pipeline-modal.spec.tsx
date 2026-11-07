import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { mockEmojiData } from '@/test/emoji-picker'
import PublishAsKnowledgePipelineModal from '../publish-as-knowledge-pipeline-modal'

mockEmojiData()

it.each([
  { action: 'commit', background: '#F3FEE7' },
  { action: 'cancel', background: '#fff' },
])(
  'keeps the $action decision from the icon picker in the submitted template',
  async ({ action, background }) => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    renderWorkflowComponent(
      <PublishAsKnowledgePipelineModal onConfirm={onConfirm} onCancel={vi.fn()} />,
      {
        resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
        initialStoreState: {
          knowledgeName: 'Documentation',
          knowledgeIcon: { icon_type: 'emoji', icon: '🔧', icon_background: '#fff', icon_url: '' },
        },
      },
    )
    await user.click(
      screen.getByRole('button', {
        name: 'common.operation.edit pipeline.common.publishAsPipeline.name',
      }),
    )
    await user.click(screen.getByRole('radio', { name: 'app.iconPicker.color.green' }))
    if (action === 'commit')
      await user.click(screen.getByRole('button', { name: /iconPicker\.ok/ }))
    else await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('app.iconPicker.search')).not.toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: 'workflow.common.publish' }))
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(
      'Documentation',
      {
        icon_type: 'emoji',
        icon: '🔧',
        icon_background: background,
        icon_url: '',
      },
      '',
    )
  },
)
