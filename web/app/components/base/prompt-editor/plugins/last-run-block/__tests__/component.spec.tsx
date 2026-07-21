import type { RefObject } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LastRunBlockNode } from '..'
import { CustomTextNode } from '../../custom-text/node'
import LastRunBlockComponent from '../component'

const { mockUseSelectOrDelete } = vi.hoisted(() => ({
  mockUseSelectOrDelete: vi.fn(),
}))

vi.mock('../../../hooks', () => ({
  useSelectOrDelete: (...args: unknown[]) => mockUseSelectOrDelete(...args),
}))

const createHookReturn = (isSelected: boolean): [RefObject<HTMLDivElement | null>, boolean] => {
  return [{ current: null }, isSelected]
}

const renderComponent = (props?: {
  isSelected?: boolean
  withNode?: boolean
  onParentClick?: () => void
}) => {
  const { isSelected = false, withNode = true, onParentClick } = props ?? {}

  mockUseSelectOrDelete.mockReturnValue(createHookReturn(isSelected))

  return render(
    <LexicalComposer
      initialConfig={{
        namespace: 'last-run-block-component-test',
        onError: (error: Error) => {
          throw error
        },
        nodes: withNode ? [CustomTextNode, LastRunBlockNode] : [CustomTextNode],
      }}
    >
      <button type="button" onClick={onParentClick}>
        <LastRunBlockComponent nodeKey="last-run-node" />
      </button>
    </LexicalComposer>,
  )
}

describe('LastRunBlockComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the last run label when selected', () => {
      renderComponent({ isSelected: true })

      expect(screen.getByText('last_run')).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should stop click propagation from wrapper', async () => {
      const user = userEvent.setup()
      const onParentClick = vi.fn()

      renderComponent({ onParentClick })
      await user.click(screen.getByText('last_run'))

      expect(onParentClick).not.toHaveBeenCalled()
    })
  })

  describe('Node registration guard', () => {
    it('should throw when last run node is not registered on editor', () => {
      expect(() => {
        renderComponent({ withNode: false })
      }).toThrow('WorkflowVariableBlockPlugin: WorkflowVariableBlock not registered on editor')
    })
  })
})
