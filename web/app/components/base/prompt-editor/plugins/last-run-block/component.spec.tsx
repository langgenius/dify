import type { RefObject } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LastRunBlockNode } from '.'
import { CustomTextNode } from '../custom-text/node'
import LastRunBlockComponent from './component'

const { mockUseSelectOrDelete } = vi.hoisted(() => ({
  mockUseSelectOrDelete: vi.fn(),
}))

vi.mock('../../hooks', () => ({
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
  const {
    isSelected = false,
    withNode = true,
    onParentClick,
  } = props ?? {}

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
      <div onClick={onParentClick}>
        <LastRunBlockComponent nodeKey="last-run-node" />
      </div>
    </LexicalComposer>,
  )
}

describe('LastRunBlockComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render last run label and apply selected classes when selected', () => {
      const { container } = renderComponent({ isSelected: true })
      const wrapper = container.querySelector('.group\\/wrap')

      expect(screen.getByText('last_run')).toBeInTheDocument()
      expect(wrapper).toHaveClass('border-state-accent-solid')
      expect(wrapper).toHaveClass('bg-state-accent-hover')
    })

    it('should apply default classes when not selected', () => {
      const { container } = renderComponent({ isSelected: false })
      const wrapper = container.querySelector('.group\\/wrap')

      expect(wrapper).toHaveClass('border-components-panel-border-subtle')
      expect(wrapper).toHaveClass('bg-components-badge-white-to-dark')
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
