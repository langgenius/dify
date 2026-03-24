import type { TFunction } from 'i18next'
import { render, screen } from '@testing-library/react'
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
})
