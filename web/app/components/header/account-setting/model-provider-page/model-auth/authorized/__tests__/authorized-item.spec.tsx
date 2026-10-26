import type { ModelProvider } from '../../../declarations'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import {
  ConfigurationMethodEnum,
  CustomConfigurationStatusEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
} from '../../../declarations'
import { AuthorizedItem } from '../authorized-item'

const credentials = [
  { credential_id: 'c1', credential_name: 'Primary key' },
  { credential_id: 'c2', credential_name: 'Backup key' },
]
const model = { model: 'gpt-4', model_type: ModelTypeEnum.textGeneration }
const provider: ModelProvider = {
  provider: 'openai',
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  supported_model_types: [ModelTypeEnum.textGeneration],
  configurate_methods: [ConfigurationMethodEnum.customizableModel],
  preferred_provider_type: PreferredProviderTypeEnum.custom,
  custom_configuration: { status: CustomConfigurationStatusEnum.active, custom_models: [model] },
  system_configuration: { enabled: false, quota_configurations: [] },
}

it('selects a credential with its model identity and blocks selection while disabled', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  function Credentials({ disabled }: { disabled: boolean }) {
    const [selected, setSelected] = useState('c1')
    return (
      <AuthorizedItem
        provider={provider}
        model={model}
        credentials={credentials}
        disabled={disabled}
        showItemSelectedIcon
        selectedCredentialId={selected}
        onItemClick={(credential, selectedModel) => {
          onSelect(credential, selectedModel)
          setSelected(credential.credential_id)
        }}
      />
    )
  }
  const { rerender } = render(<Credentials disabled={false} />)
  await user.click(screen.getByRole('button', { name: 'Backup key' }))
  expect(onSelect).toHaveBeenCalledWith(credentials[1], model)
  expect(screen.getByRole('button', { name: 'Backup key' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Primary key' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  rerender(<Credentials disabled />)
  await user.click(screen.getByRole('button', { name: 'Primary key' }))
  expect(onSelect).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Backup key' })).toHaveAttribute('aria-pressed', 'true')
})
