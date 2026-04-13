import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import VariableInspectPanel from '../index'

describe('variable inspect index', () => {
  it('renders nothing when the inspect panel is hidden', () => {
    const { container } = renderWorkflowComponent(<VariableInspectPanel />, {
      initialStoreState: {
        showVariableInspectPanel: false,
      },
    })

    expect(container).toBeEmptyDOMElement()
  })
})
