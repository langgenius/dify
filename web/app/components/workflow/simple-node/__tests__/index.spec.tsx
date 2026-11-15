import type { CommonNodeType } from '../../types'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus } from '../../types'
import SimpleNode from '../index'

const control = vi.fn()
const handle = vi.fn()
// Controls and connection handles have independent interaction coverage.
vi.mock('@/app/components/workflow/nodes/_base/components/node-control', () => ({
  default: (props: { id: string }) => {
    control(props)
    return null
  },
}))
vi.mock('@/app/components/workflow/nodes/_base/components/node-handle', () => ({
  NodeTargetHandle: (props: { id: string; handleId: string }) => {
    handle(props)
    return null
  },
}))

it.each([
  {
    name: 'editable',
    readOnly: false,
    candidate: false,
    status: undefined,
    controls: true,
    connection: true,
  },
  {
    name: 'running',
    readOnly: false,
    candidate: false,
    status: NodeRunningStatus.Running,
    controls: false,
    connection: true,
  },
  {
    name: 'candidate',
    readOnly: false,
    candidate: true,
    status: undefined,
    controls: false,
    connection: false,
  },
  {
    name: 'readonly',
    readOnly: true,
    candidate: false,
    status: undefined,
    controls: false,
    connection: true,
  },
])(
  'exposes the appropriate controls for an $name node',
  ({ readOnly, candidate, status, controls, connection }) => {
    const data: CommonNodeType = {
      title: 'Answer',
      desc: '',
      type: BlockEnum.Answer,
      _isCandidate: candidate,
      _runningStatus: status,
    }
    renderWorkflowComponent(<SimpleNode id="simple-node" data={data} />, {
      initialStoreState: { canvasReadOnly: readOnly },
    })
    if (controls)
      expect(control).toHaveBeenCalledWith(expect.objectContaining({ id: 'simple-node' }))
    else expect(control).not.toHaveBeenCalled()
    if (connection)
      expect(handle).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'simple-node', handleId: 'target' }),
      )
    else expect(handle).not.toHaveBeenCalled()
  },
)
