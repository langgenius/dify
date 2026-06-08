import type { TFunction } from 'i18next'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import { NodeBody, NodeDescription, NodeHeaderMeta } from '../node-sections'

describe('node sections', () => {
  it('should render loop and loading metadata in the header section', () => {
    const t = ((key: string) => key) as unknown as TFunction

    render(
      <NodeHeaderMeta
        data={{
          type: BlockEnum.Loop,
          _loopIndex: 2,
          _runningStatus: NodeRunningStatus.Running,
        } as never}
        hasVarValue={false}
        isLoading
        loopIndex={<div>loop-index</div>}
        t={t}
      />,
    )

    expect(screen.getByText('loop-index')).toBeInTheDocument()
    expect(document.querySelector('.i-ri-loader-2-line')).toBeInTheDocument()
  })

  it('should render the container node body and description branches', () => {
    const { rerender } = render(
      <NodeBody
        data={{ type: BlockEnum.Loop } as never}
        child={<div>body-content</div>}
      />,
    )

    expect(screen.getByText('body-content').parentElement).toHaveClass('grow')

    rerender(<NodeDescription data={{ type: BlockEnum.Tool, desc: 'node description' } as never} />)
    expect(screen.getByText('node description')).toBeInTheDocument()
  })

  it('should render iteration parallel metadata and running progress', async () => {
    const t = ((key: string) => key) as unknown as TFunction
    const user = userEvent.setup()

    render(
      <NodeHeaderMeta
        data={{
          type: BlockEnum.Iteration,
          is_parallel: true,
          _iterationLength: 3,
          _iterationIndex: 5,
          _runningStatus: NodeRunningStatus.Running,
        } as never}
        hasVarValue={false}
        isLoading={false}
        loopIndex={null}
        t={t}
      />,
    )

    expect(screen.getByText('nodes.iteration.parallelModeUpper')).toBeInTheDocument()
    await user.hover(screen.getByText('nodes.iteration.parallelModeUpper'))
    expect(await screen.findByText('nodes.iteration.parallelModeEnableTitle')).toBeInTheDocument()
    expect(screen.getByText('nodes.iteration.parallelModeEnableDesc')).toBeInTheDocument()
    expect(screen.getByText('3/3')).toBeInTheDocument()
  })

  it('should render failed, exception, success and paused status icons', () => {
    const t = ((key: string) => key) as unknown as TFunction
    const { rerender } = render(
      <NodeHeaderMeta
        data={{ type: BlockEnum.Tool, _runningStatus: NodeRunningStatus.Failed } as never}
        hasVarValue={false}
        isLoading={false}
        loopIndex={null}
        t={t}
      />,
    )

    expect(document.querySelector('.i-ri-error-warning-fill')).toBeInTheDocument()

    rerender(
      <NodeHeaderMeta
        data={{ type: BlockEnum.Tool, _runningStatus: NodeRunningStatus.Exception } as never}
        hasVarValue={false}
        isLoading={false}
        loopIndex={null}
        t={t}
      />,
    )
    expect(document.querySelector('.i-ri-alert-fill')).toBeInTheDocument()

    rerender(
      <NodeHeaderMeta
        data={{ type: BlockEnum.Tool, _runningStatus: NodeRunningStatus.Succeeded } as never}
        hasVarValue={false}
        isLoading={false}
        loopIndex={null}
        t={t}
      />,
    )
    expect(document.querySelector('.i-ri-checkbox-circle-fill')).toBeInTheDocument()

    rerender(
      <NodeHeaderMeta
        data={{ type: BlockEnum.Tool, _runningStatus: NodeRunningStatus.Paused } as never}
        hasVarValue={false}
        isLoading={false}
        loopIndex={null}
        t={t}
      />,
    )
    expect(document.querySelector('.i-ri-pause-circle-fill')).toBeInTheDocument()
  })

  it('should render success icon when inspect vars exist without running status and hide description for loop nodes', () => {
    const t = ((key: string) => key) as unknown as TFunction
    const { rerender } = render(
      <NodeHeaderMeta
        data={{ type: BlockEnum.Tool } as never}
        hasVarValue
        isLoading={false}
        loopIndex={null}
        t={t}
      />,
    )

    expect(document.querySelector('.i-ri-checkbox-circle-fill')).toBeInTheDocument()

    rerender(<NodeDescription data={{ type: BlockEnum.Loop, desc: 'hidden' } as never} />)
    expect(screen.queryByText('hidden')).not.toBeInTheDocument()
  })
})
