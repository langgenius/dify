import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTranslation } from 'react-i18next'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import { NodeHeaderMeta } from '../node-sections'

it('caps parallel iteration progress at its total and explains parallel execution', async () => {
  const Harness = () => {
    const { t } = useTranslation(['workflow'])
    const data = {
      title: 'Iteration',
      desc: '',
      type: BlockEnum.Iteration,
      is_parallel: true,
      _iterationLength: 3,
      _iterationIndex: 5,
      _runningStatus: NodeRunningStatus.Running,
    }
    return (
      <NodeHeaderMeta data={data} hasVarValue={false} isLoading={false} loopIndex={null} t={t} />
    )
  }
  render(<Harness />)
  expect(screen.getByText('3/3')).toBeInTheDocument()
  expect(screen.getByText('workflow.nodes.iteration.parallelModeUpper')).toBeInTheDocument()
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'workflow.nodes.iteration.parallelModeEnableTitle' }))
  expect(await screen.findByRole('dialog')).toHaveTextContent(
    'workflow.nodes.iteration.parallelModeEnableDesc',
  )
})
