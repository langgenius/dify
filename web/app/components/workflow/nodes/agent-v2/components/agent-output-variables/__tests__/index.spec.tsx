import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { agentV2SystemTextOutput } from '../../../output-variables'
import { AgentOutputVariables } from '../index'

const editorLabel = 'workflow.nodes.agent.outputVars.editorLabel'
const nameLabel = 'workflow.nodes.agent.outputVars.nameLabel'
const confirmLabel = 'workflow.nodes.agent.outputVars.confirm'

async function expandOutputVars(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' }))
}

function getAddButton(name: string) {
  return screen.getByRole('button', { name: `common.operation.add ${name}` })
}

function getEditButton(name: string) {
  return screen.getByRole('button', {
    name: `workflow.nodes.agent.outputVars.edit:{"name":"${name}"}`,
  })
}

function getDeleteButton(name: string) {
  return screen.getByRole('button', {
    name: `workflow.nodes.agent.outputVars.delete:{"name":"${name}"}`,
  })
}

async function confirmEditorName(user: ReturnType<typeof userEvent.setup>, name: string) {
  const editor = screen.getByRole('form', { name: editorLabel })
  const nameInput = within(editor).getByLabelText(nameLabel)

  await user.clear(nameInput)
  await user.type(nameInput, name)
  await user.click(within(editor).getByRole('button', { name: confirmLabel }))
}

describe('AgentOutputVariables', () => {
  it('should keep system text immutable while custom outputs remain editable', async () => {
    const user = userEvent.setup()
    const outputs: DeclaredOutputConfig[] = [
      agentV2SystemTextOutput,
      {
        name: 'summary',
        type: 'string',
        required: false,
      },
    ]

    render(<AgentOutputVariables outputs={outputs} onChange={vi.fn()} />)

    await expandOutputVars(user)

    expect(
      screen.queryByRole('button', {
        name: 'workflow.nodes.agent.outputVars.edit:{"name":"text"}',
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'workflow.nodes.agent.outputVars.delete:{"name":"text"}',
      }),
    ).not.toBeInTheDocument()
    expect(getEditButton('summary')).toBeInTheDocument()
    expect(getDeleteButton('summary')).toBeInTheDocument()
  })

  it('should add an object child without opening the parent editor', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const outputs: DeclaredOutputConfig[] = [
      {
        name: 'profile',
        type: 'object',
        required: true,
        description: 'User profile',
      },
    ]

    render(<AgentOutputVariables outputs={outputs} onChange={onChange} />)

    await expandOutputVars(user)
    await user.click(getAddButton('profile'))

    expect(screen.getAllByRole('form', { name: editorLabel })).toHaveLength(1)
    expect(screen.getByText('profile')).toBeInTheDocument()

    await confirmEditorName(user, 'email')

    expect(onChange).toHaveBeenCalledWith([
      {
        name: 'profile',
        type: 'object',
        required: true,
        description: 'User profile',
        children: [
          {
            name: 'email',
            type: 'string',
            required: false,
          },
        ],
      },
    ])
  })

  it('should append children to array object items', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const outputs: DeclaredOutputConfig[] = [
      {
        name: 'addresses',
        type: 'array',
        required: false,
        array_item: {
          type: 'object',
        },
      },
    ]

    render(<AgentOutputVariables outputs={outputs} onChange={onChange} />)

    await expandOutputVars(user)
    await user.click(getAddButton('addresses'))
    await confirmEditorName(user, 'city')

    expect(onChange).toHaveBeenCalledWith([
      {
        name: 'addresses',
        type: 'array',
        required: false,
        array_item: {
          type: 'object',
          children: [
            {
              name: 'city',
              type: 'string',
              required: false,
            },
          ],
        },
      },
    ])
  })

  it('should add nested children under the selected object child', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const outputs: DeclaredOutputConfig[] = [
      {
        name: 'profile',
        type: 'object',
        required: true,
        children: [
          {
            name: 'contact',
            type: 'object',
            required: true,
          },
        ],
      },
    ]

    render(<AgentOutputVariables outputs={outputs} onChange={onChange} />)

    await expandOutputVars(user)
    await user.click(getAddButton('contact'))
    await confirmEditorName(user, 'email')

    expect(onChange).toHaveBeenCalledWith([
      {
        name: 'profile',
        type: 'object',
        required: true,
        children: [
          {
            name: 'contact',
            type: 'object',
            required: true,
            children: [
              {
                name: 'email',
                type: 'string',
                required: false,
              },
            ],
          },
        ],
      },
    ])
  })

  it('should edit only the selected nested child', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const outputs: DeclaredOutputConfig[] = [
      {
        name: 'profile',
        type: 'object',
        required: true,
        children: [
          {
            name: 'contact',
            type: 'object',
            required: true,
            children: [
              {
                name: 'email',
                type: 'string',
                required: true,
                description: 'Primary email',
              },
            ],
          },
        ],
      },
    ]

    render(<AgentOutputVariables outputs={outputs} onChange={onChange} />)

    await expandOutputVars(user)
    await user.click(getEditButton('email'))

    expect(screen.getAllByRole('form', { name: editorLabel })).toHaveLength(1)

    await confirmEditorName(user, 'work_email')

    expect(onChange).toHaveBeenCalledWith([
      {
        name: 'profile',
        type: 'object',
        required: true,
        children: [
          {
            name: 'contact',
            type: 'object',
            required: true,
            children: [
              {
                name: 'work_email',
                type: 'string',
                required: true,
                description: 'Primary email',
              },
            ],
          },
        ],
      },
    ])
  })

  it('should reject editing an output name with dots', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const outputs: DeclaredOutputConfig[] = [
      {
        name: 'summary',
        type: 'string',
        required: true,
      },
    ]

    render(<AgentOutputVariables outputs={outputs} onChange={onChange} />)

    await expandOutputVars(user)
    await user.click(getEditButton('summary'))
    await confirmEditorName(user, 'report.summary')

    expect(screen.getByText('workflow.nodes.agent.outputVars.nameInvalid')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each(['text', 'switch', '_session'])('should reject reserved output name %s', async (name) => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<AgentOutputVariables outputs={[]} onChange={onChange} />)

    await expandOutputVars(user)
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.agent.outputVars.newOutput' }),
    )
    await confirmEditorName(user, name)

    expect(screen.getByText('workflow.nodes.agent.outputVars.nameInvalid')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})
