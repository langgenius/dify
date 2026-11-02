import type { ComponentProps } from 'react'
import type { DeliveryMethod, EmailConfig, FormInputItem, HumanInputNodeType } from '../../../types'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import { DeliveryMethodType } from '../../../types'
import DeliveryMethodItem from '../method-item'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.members.get': () => ({ accounts: [] }),
    }),
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createInstance } = await vi.importActual<typeof import('i18next')>('i18next')
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: translations } = await import('@/i18n/locales/en-US/workflow-human-input.json')
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    fallbackLng: false,
    keySeparator: false,
    resources: { 'en-US': { workflowHumanInput: translations } },
  })
  return {
    ...actual,
    ...createReactI18nextMock(),
    Trans: (props: ComponentProps<typeof actual.Trans>) => <actual.Trans {...props} i18n={i18n} />,
  }
})

const createEmailConfig = (overrides: Partial<EmailConfig> = {}): EmailConfig => ({
  recipients: {
    whole_workspace: false,
    items: [{ type: 'external', email: 'test@example.com' }],
  },
  subject: 'Hello',
  body: '{{#url#}}',
  debug_mode: false,
  ...overrides,
})

const formInputs: FormInputItem[] = [
  {
    type: InputVarType.paragraph,
    output_variable_name: 'name',
    default: {
      selector: ['start', 'name'],
      type: 'constant',
      value: '',
    },
  },
]

const nodesOutputVars: NodeOutPutVar[] = [
  {
    nodeId: 'start',
    title: 'Start',
    vars: [{ variable: 'name', type: VarType.string }],
  },
]

function DeliveryMethodHarness({
  availableNodes,
  initialMethod,
  readonly = false,
}: {
  availableNodes: Node[]
  initialMethod: DeliveryMethod
  readonly?: boolean
}) {
  const [method, setMethod] = useState<DeliveryMethod | null>(initialMethod)
  return (
    <>
      {method && (
        <DeliveryMethodItem
          nodeId="human-input"
          method={method}
          nodesOutputVars={nodesOutputVars}
          availableNodes={availableNodes}
          formContent="Hello {{#url#}}"
          formInputs={formInputs}
          onChange={setMethod}
          onDelete={(type) => setMethod((current) => (current?.type === type ? null : current))}
          readonly={readonly}
        />
      )}
      <output aria-label="Saved delivery method">
        {method ? JSON.stringify(method) : 'removed'}
      </output>
    </>
  )
}

const renderMethod = (initialMethod: DeliveryMethod, readonly = false) => {
  const start = createStartNode({
    id: 'start',
    data: {
      variables: [
        { variable: 'name', label: 'Name', type: InputVarType.textInput, required: false },
      ],
    },
  })
  const humanInputData: HumanInputNodeType = {
    title: 'Human input',
    desc: '',
    type: BlockEnum.HumanInput,
    delivery_methods: [initialMethod],
    form_content: 'Hello {{#url#}}',
    inputs: formInputs,
    user_actions: [],
    timeout: 3,
    timeout_unit: 'day',
  }
  const humanInput = createNode({ id: 'human-input', data: humanInputData })
  return renderWorkflowEditor(
    <DeliveryMethodHarness
      availableNodes={[start]}
      initialMethod={initialMethod}
      readonly={readonly}
    />,
    {
      nodes: [start, humanInput],
      edges: [
        createEdge({
          source: 'start',
          target: 'human-input',
          data: { sourceType: BlockEnum.Start, targetType: BlockEnum.HumanInput },
        }),
      ],
    },
  )
}

const savedMethod = () => screen.getByRole('status', { name: 'Saved delivery method' })

describe('human-input/delivery-method/method-item', () => {
  it('toggles and deletes a webapp delivery method through controlled owner state', async () => {
    const user = userEvent.setup()
    renderMethod({ id: 'webapp-1', type: DeliveryMethodType.WebApp, enabled: true })

    const enabled = screen.getByRole('switch')
    expect(enabled).toBeChecked()
    await user.click(enabled)
    expect(enabled).not.toBeChecked()
    expect(savedMethod()).toHaveTextContent(
      JSON.stringify({ id: 'webapp-1', type: DeliveryMethodType.WebApp, enabled: false }),
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(savedMethod()).toHaveTextContent('removed')
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('uses the real test sender and saves subject and body edits from the real configuration form', async () => {
    const user = userEvent.setup()
    // The jump button exists only for non-debug email with specific recipients; a debug fixture
    // cannot reach this production branch.
    renderMethod({
      id: 'email-1',
      type: DeliveryMethodType.Email,
      enabled: true,
      config: createEmailConfig(),
    })

    const testButton = screen.getByRole('button', { name: /emailSender.testSendTip/ })
    await user.click(testButton)
    let sender = screen.getByRole('dialog', { name: /emailSender.title/ })
    await user.click(within(sender).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(testButton)
    sender = screen.getByRole('dialog', { name: /emailSender.title/ })
    await user.click(within(sender).getByRole('button', { name: 'enable Debug Mode' }))
    const configure = await screen.findByRole('dialog', { name: /emailConfigure.title/ })
    expect(screen.queryByRole('dialog', { name: /emailSender.title/ })).not.toBeInTheDocument()
    await user.click(within(configure).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'workflow.common.configure' }))
    const subject = screen.getByRole('textbox', { name: /emailConfigure.subject$/ })
    await user.clear(subject)
    await user.type(subject, 'Configured subject')
    const body = screen.getByRole('textbox', { name: /emailConfigure.body$/ })
    await replacePromptEditorText(body, 'Configured body {{#url#}}')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(savedMethod()).toHaveTextContent(
      JSON.stringify({
        id: 'email-1',
        type: DeliveryMethodType.Email,
        enabled: true,
        config: createEmailConfig({
          subject: 'Configured subject',
          body: 'Configured body {{#url#}}',
        }),
      }),
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(savedMethod()).toHaveTextContent('removed')
  })

  it('opens and dismisses the real configuration form for an unconfigured email method', async () => {
    const user = userEvent.setup()
    const method: DeliveryMethod = {
      id: 'email-2',
      type: DeliveryMethodType.Email,
      enabled: false,
      config: undefined,
    }
    renderMethod(method)

    await user.click(
      screen.getByRole('button', {
        name: /workflowHumanInput.nodes.humanInput.deliveryMethod.notConfigured/i,
      }),
    )
    const configure = screen.getByRole('dialog', { name: /emailConfigure.title/ })
    expect(within(configure).getByRole('textbox', { name: /emailConfigure.subject$/ })).toHaveValue(
      '',
    )
    await user.click(within(configure).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(savedMethod()).toHaveTextContent(JSON.stringify(method))
  })

  it('keeps actions disabled in readonly mode without changing owner state', async () => {
    const user = userEvent.setup()
    const method: DeliveryMethod = {
      id: 'email-3',
      type: DeliveryMethodType.Email,
      enabled: true,
      config: createEmailConfig(),
    }
    renderMethod(method, true)

    const enabled = screen.getByRole('switch')
    expect(enabled).toHaveAttribute('aria-disabled', 'true')
    await user.click(enabled)
    expect(enabled).toBeChecked()
    expect(
      screen.queryByRole('button', { name: 'common.operation.remove' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'workflow.common.configure' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(savedMethod()).toHaveTextContent(JSON.stringify(method))
  })
})
