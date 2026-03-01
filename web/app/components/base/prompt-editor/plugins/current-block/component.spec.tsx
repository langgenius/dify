import type { RefObject } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import { CurrentBlockNode, DELETE_CURRENT_BLOCK_COMMAND } from '.'
import { CustomTextNode } from '../custom-text/node'
import CurrentBlockComponent from './component'

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
  generatorType?: GeneratorType
}) => {
  const {
    isSelected = false,
    withNode = true,
    onParentClick,
    generatorType = GeneratorType.prompt,
  } = props ?? {}

  mockUseSelectOrDelete.mockReturnValue(createHookReturn(isSelected))

  return render(
    <LexicalComposer
      initialConfig={{
        namespace: 'current-block-component-test',
        onError: (error: Error) => {
          throw error
        },
        nodes: withNode ? [CustomTextNode, CurrentBlockNode] : [CustomTextNode],
      }}
    >
      <div onClick={onParentClick}>
        <CurrentBlockComponent nodeKey="current-node" generatorType={generatorType} />
      </div>
    </LexicalComposer>,
  )
}

describe('CurrentBlockComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render prompt label and selected classes when generator type is prompt and selected', () => {
      const { container } = renderComponent({
        generatorType: GeneratorType.prompt,
        isSelected: true,
      })
      const wrapper = container.querySelector('.group\\/wrap')

      expect(screen.getByText('current_prompt')).toBeInTheDocument()
      expect(wrapper).toHaveClass('border-state-accent-solid')
      expect(wrapper).toHaveClass('bg-state-accent-hover')
    })

    it('should render code label and default classes when generator type is code and not selected', () => {
      const { container } = renderComponent({
        generatorType: GeneratorType.code,
        isSelected: false,
      })
      const wrapper = container.querySelector('.group\\/wrap')

      expect(screen.getByText('current_code')).toBeInTheDocument()
      expect(wrapper).toHaveClass('border-components-panel-border-subtle')
      expect(wrapper).toHaveClass('bg-components-badge-white-to-dark')
    })

    it('should wire useSelectOrDelete with node key and delete command', () => {
      renderComponent({ generatorType: GeneratorType.prompt })

      expect(mockUseSelectOrDelete).toHaveBeenCalledWith('current-node', DELETE_CURRENT_BLOCK_COMMAND)
    })
  })

  describe('Interactions', () => {
    it('should stop click propagation from wrapper', async () => {
      const user = userEvent.setup()
      const onParentClick = vi.fn()

      renderComponent({ onParentClick, generatorType: GeneratorType.prompt })
      await user.click(screen.getByText('current_prompt'))

      expect(onParentClick).not.toHaveBeenCalled()
    })
  })

  describe('Node registration guard', () => {
    it('should throw when current block node is not registered on editor', () => {
      expect(() => {
        renderComponent({ withNode: false })
      }).toThrow('WorkflowVariableBlockPlugin: WorkflowVariableBlock not registered on editor')
    })
  })
})
