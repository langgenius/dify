import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { WorkflowToolDrawerPayload } from '.'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { fn } from 'storybook/test'
import { VarType } from '@/app/components/workflow/types'
import { WorkflowToolDrawer } from '.'

const payload = {
  icon: {
    content: '🔀',
    background: '#EEF4FF',
  },
  label: 'Branching Workflow',
  name: 'branching_workflow',
  description: 'Returns different outputs depending on the executed branch.',
  parameters: [
    {
      name: 'route',
      description: 'Selects the branch to execute.',
      form: 'llm',
      required: true,
      type: 'string',
    },
  ],
  outputParameters: [
    {
      name: 'aaa',
      description: 'Output from the first End node.',
      type: VarType.string,
    },
    {
      name: 'bbb',
      description: 'Output from the second End node.',
      type: VarType.number,
    },
    {
      name: 'result',
      description: 'Declared as different types across multiple End nodes.',
      type: VarType.number,
      typeConflict: true,
    },
    {
      name: 'text',
      description: 'Conflicts with a reserved workflow tool output.',
      type: VarType.string,
    },
  ],
  labels: [],
  privacy_policy: '',
  workflow_app_id: 'workflow-app-story',
} satisfies WorkflowToolDrawerPayload

const meta = {
  title: 'Tools/WorkflowTool/Drawer',
  component: WorkflowToolDrawer,
  decorators: [
    (Story) => (
      <TooltipProvider delay={0} closeDelay={100}>
        <Story />
      </TooltipProvider>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Configures a published workflow as a tool. This story covers the union of outputs from multiple End nodes, including a conflicting output type and a reserved output name.',
      },
    },
  },
  args: {
    isAdd: true,
    payload,
    onCreate: fn(),
    onHide: fn(),
  },
} satisfies Meta<typeof WorkflowToolDrawer>

export default meta
type Story = StoryObj<typeof meta>

export const MultipleEndOutputs: Story = {}
