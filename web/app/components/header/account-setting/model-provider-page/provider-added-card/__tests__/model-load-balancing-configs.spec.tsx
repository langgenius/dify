import type { ComponentProps } from 'react'
import type { ModelCredential, ModelLoadBalancingConfig } from '../../declarations'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { createProviderResponseFixture } from '@/test/console/model-provider'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { ConfigurationMethodEnum, ModelTypeEnum } from '../../declarations'
import { modelProviderDetailsQueryOptions } from '../../utils'
import ModelLoadBalancingConfigs from '../model-load-balancing-configs'

const provider = modelProviderDetailsQueryOptions().select!({
  data: [createProviderResponseFixture({ provider: 'test-provider' })],
}).data[0]!
const model = { model: 'gpt-4', model_type: ModelTypeEnum.textGeneration }
const createDraft = (enabled = true): ModelLoadBalancingConfig => ({
  enabled,
  configs: [
    { id: 'cfg-1', credential_id: 'cred-1', enabled: true, name: 'Key 1', credentials: {} },
  ],
})
const credential: ModelCredential = {
  credentials: {},
  load_balancing: createDraft(),
  available_credentials: [
    { credential_id: 'cred-1', credential_name: 'Key 1' },
    { credential_id: 'cred-2', credential_name: 'Key 2' },
    { credential_id: 'cred-enterprise', credential_name: 'Enterprise Key', from_enterprise: true },
  ],
}
type Props = ComponentProps<typeof ModelLoadBalancingConfigs>
function DraftEditor({
  initialConfig = createDraft(),
  ...props
}: Partial<Omit<Props, 'draftConfig' | 'setDraftConfig'>> & {
  initialConfig?: ModelLoadBalancingConfig
}) {
  const [draft, setDraft] = useState<ModelLoadBalancingConfig | undefined>(initialConfig)
  return (
    <>
      <output aria-label="Draft load balancing configuration">{JSON.stringify(draft)}</output>
      <ModelLoadBalancingConfigs
        provider={provider}
        model={model}
        modelCredential={credential}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
        {...props}
        draftConfig={draft}
        setDraftConfig={setDraft}
      />
    </>
  )
}
function setup(props: ComponentProps<typeof DraftEditor> = {}, enabled = true) {
  const onUrlUpdate = vi.fn()
  renderWithConsoleQuery(
    <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
      <DraftEditor {...props} />
    </NuqsTestingAdapter>,
    {
      systemFeatures: { deployment_edition: 'CLOUD' },
      features: { model_load_balancing_enabled: enabled },
      workspacePermissionKeys: ['credential.use'],
    },
  )
  return { user: userEvent.setup(), onUrlUpdate }
}
const readDraft = (): ModelLoadBalancingConfig =>
  JSON.parse(screen.getByLabelText('Draft load balancing configuration').textContent!)
const balancingName = 'modelProvider.modelProvider.loadBalancing'
const modeButton = () =>
  screen
    .queryAllByRole('button', { name: balancingName })
    .find((button) => !button.hasAttribute('aria-haspopup'))
const addCredential = () =>
  screen.getByRole('button', { name: 'modelProvider.modelProvider.auth.addCredential' })
afterEach(() => vi.useRealTimers())

it('enables the saved configuration from the mode chooser', async () => {
  const { user } = setup({ initialConfig: createDraft(false) })
  expect(modeButton()).toBeInTheDocument()
  await user.click(modeButton()!)
  expect(screen.getByRole('switch', { name: 'Key 1' })).toBeChecked()
  expect(readDraft()).toEqual(createDraft())
})

it('selects an existing credential through the real menu and removes only the chosen entry', async () => {
  const { user } = setup()
  expect(screen.getByText(/loadBalancingLeastKeyWarning/)).toBeInTheDocument()
  await user.click(addCredential())
  await user.click(await screen.findByRole('button', { name: 'Key 2' }))
  expect(screen.getByRole('switch', { name: 'Key 2' })).toBeChecked()
  expect(screen.queryByText(/loadBalancingLeastKeyWarning/)).not.toBeInTheDocument()
  expect(readDraft().configs).toEqual([
    ...createDraft().configs,
    { credential_id: 'cred-2', enabled: true, name: 'Key 2' },
  ])
  await user.click(screen.getByRole('button', { name: 'common.operation.remove Key 1' }))
  expect(screen.queryByRole('switch', { name: 'Key 1' })).not.toBeInTheDocument()
  expect(screen.getByRole('switch', { name: 'Key 2' })).toBeChecked()
  expect(readDraft().configs).toEqual([{ credential_id: 'cred-2', enabled: true, name: 'Key 2' }])
  expect(screen.getByText(/loadBalancingLeastKeyWarning/)).toBeInTheDocument()
})

it('preserves credential choices and entry toggles when load balancing is disabled and reenabled', async () => {
  const { user } = setup({ withSwitch: true })
  await user.click(screen.getByRole('switch', { name: 'Key 1' }))
  expect(readDraft().configs[0]).toMatchObject({ credential_id: 'cred-1', enabled: false })
  await user.click(screen.getByRole('switch', { name: balancingName }))
  expect(screen.queryByRole('switch', { name: 'Key 1' })).not.toBeInTheDocument()
  expect(readDraft().enabled).toBe(false)
  await user.click(screen.getByRole('switch', { name: balancingName }))
  const entry = screen.getByRole('switch', { name: 'Key 1' })
  expect(entry).not.toBeChecked()
  await user.click(entry)
  expect(readDraft()).toEqual(createDraft())
})

it.each([false, true])(
  'blocks activation without entitlement and offers the pricing page (switch=%s)',
  async (withSwitch) => {
    const { user, onUrlUpdate } = setup({ initialConfig: createDraft(false), withSwitch }, false)
    if (withSwitch) {
      const toggle = screen.getByRole('switch', { name: balancingName })
      expect(toggle).toHaveAttribute('aria-disabled', 'true')
      await user.click(toggle)
      expect(toggle).not.toBeChecked()
    } else {
      expect(modeButton()).toBeUndefined()
    }
    expect(readDraft()).toEqual(createDraft(false))
    expect(screen.queryByRole('switch', { name: 'Key 1' })).not.toBeInTheDocument()
    expect(
      screen.getByText('modelProvider.modelProvider.upgradeForLoadBalancing'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'billing.upgradeBtn.encourage' }))
    await waitFor(() =>
      expect(onUrlUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          queryString: '?pricing=open',
        }),
      ),
    )
  },
)

it('allows an existing configuration to be disabled after its entitlement expires', async () => {
  const { user } = setup({ withSwitch: true }, false)
  await user.click(screen.getByRole('switch', { name: balancingName }))
  expect(readDraft()).toEqual(createDraft(false))
  expect(screen.queryByRole('switch', { name: 'Key 1' })).not.toBeInTheDocument()
})

it.each([ConfigurationMethodEnum.predefinedModel, ConfigurationMethodEnum.customizableModel])(
  'keeps the inherited default credential and labels provider management for %s',
  (configurationMethod) => {
    setup({
      configurationMethod,
      initialConfig: {
        enabled: true,
        configs: [
          { id: 'inherit', credential_id: '', enabled: true, name: '__inherit__', credentials: {} },
        ],
      },
    })
    expect(screen.getByText('modelProvider.modelProvider.defaultConfig')).toBeInTheDocument()
    const managed = screen.queryByText('modelProvider.modelProvider.providerManaged')
    if (configurationMethod === ConfigurationMethodEnum.predefinedModel)
      expect(managed).toBeInTheDocument()
    else expect(managed).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /common.operation.remove/ }),
    ).not.toBeInTheDocument()
  },
)

it('identifies enterprise credentials while preventing use of a restricted credential', async () => {
  const restricted = {
    credential_id: 'restricted',
    credential_name: 'Restricted Key',
    not_allowed_to_use: true,
  }
  const initialConfig: ModelLoadBalancingConfig = {
    enabled: true,
    configs: [
      { credential_id: 'cred-enterprise', name: 'Enterprise Key', enabled: true, credentials: {} },
      { credential_id: 'restricted', name: 'Restricted Key', enabled: true, credentials: {} },
    ],
  }
  const { user } = setup({
    initialConfig,
    modelCredential: {
      ...credential,
      available_credentials: [...credential.available_credentials, restricted],
    },
  })
  expect(screen.getByText('Enterprise')).toBeInTheDocument()
  const toggle = screen.getByRole('switch', { name: 'Restricted Key' })
  expect(toggle).toHaveAttribute('aria-disabled', 'true')
  expect(toggle).not.toBeChecked()
  await user.click(toggle)
  expect(readDraft()).toEqual(initialConfig)
})

it('clears cooldown metadata only when the actual timer expires', async () => {
  vi.useFakeTimers()
  const draft = createDraft()
  setup({
    initialConfig: { ...draft, configs: [{ ...draft.configs[0]!, in_cooldown: true, ttl: 30 }] },
  })
  await act(async () => vi.advanceTimersByTimeAsync(29_000))
  expect(readDraft().configs[0]).toMatchObject({ in_cooldown: true, ttl: 30 })
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(readDraft().configs[0]).toEqual({ ...draft.configs[0], in_cooldown: false })
})
