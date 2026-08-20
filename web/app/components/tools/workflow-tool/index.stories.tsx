import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import type { WorkflowToolDrawerPayload } from '.'
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
      source: { nodeId: 'end-success', nodeTitle: 'Success End', outputIndex: 0 },
    },
    {
      name: 'bbb',
      description: 'Output from the second End node.',
      type: VarType.number,
      source: { nodeId: 'end-fallback', nodeTitle: 'Fallback End', outputIndex: 0 },
    },
  ],
  labels: [],
  privacy_policy: '',
  workflow_app_id: 'workflow-app-story',
} satisfies WorkflowToolDrawerPayload

const meta = {
  title: 'Tools/WorkflowTool/Drawer',
  component: WorkflowToolDrawer,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Configures a published workflow as a tool. This story covers the union of outputs from multiple End nodes.',
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

export const PublishedOutputsWithoutDraftSources: Story = {
  args: {
    isAdd: false,
    payload: {
      ...payload,
      outputParameters: undefined,
      tool: {
        output_schema: {
          type: 'object',
          properties: {
            answer: {
              type: VarType.string,
              description: 'Output loaded from the published tool schema.',
            },
          },
        },
      },
      workflow_tool_id: 'workflow-tool-story',
    },
  },
}

export const DuplicateEndOutputs: Story = {
  args: {
    payload: {
      ...payload,
      outputParameters: [
        {
          name: 'result',
          description: 'Output from the successful branch.',
          type: VarType.string,
          source: { nodeId: 'end-success', nodeTitle: 'Success End', outputIndex: 0 },
        },
        {
          name: 'result',
          description: 'Output from the fallback branch.',
          type: VarType.number,
          source: { nodeId: 'end-fallback', nodeTitle: 'Fallback End', outputIndex: 0 },
        },
      ],
    },
  },
}

export const DuplicateReservedEndOutputs: Story = {
  args: {
    payload: {
      ...payload,
      outputParameters: [
        {
          name: 'text',
          description: 'Output from the successful branch.',
          type: VarType.string,
          source: { nodeId: 'end-success', nodeTitle: 'Output', outputIndex: 0 },
        },
        {
          name: 'text',
          description: 'Output from the fallback branch.',
          type: VarType.number,
          source: { nodeId: 'end-fallback', nodeTitle: 'Output', outputIndex: 0 },
        },
      ],
    },
  },
}
