import type { consoleClient } from '@/service/console'
import { page, userEvent } from 'vite-plus/test/browser'
import { FormItemValidateStatusEnum, FormTypeEnum } from '@/app/components/base/form/types'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderBaseField } from './base-field-test-env'

const dynamicOptions = vi.hoisted(() =>
  vi.fn<typeof consoleClient.workspaces.current.plugin.parameters.dynamicOptions.get>(),
)

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.parameters.dynamicOptions.get': dynamicOptions,
    }),
  }
})

const dynamicSelectParams = {
  plugin_id: 'plugin-1',
  provider: 'provider-1',
  action: 'choose',
  parameter: 'credential',
  credential_id: 'credential-1',
}

describe('BaseField dynamic options', () => {
  it.each([
    { type: FormTypeEnum.dynamicSelect, multiple: false },
    { type: FormTypeEnum.dynamicSelect, multiple: true },
  ])(
    'focuses the trigger from its label and supports keyboard selection (multiple: $multiple)',
    async ({ type, multiple }) => {
      const options = [{ label: { en_US: 'Primary' }, value: 'primary' }]
      dynamicOptions.mockResolvedValue({ options })
      await renderBaseField({
        formSchema: {
          type,
          dynamicSelectParams,
          multiple,
          name: 'credential',
          label: 'Credential',
          description: 'Use the workspace credential',
          tooltip: 'Credential help',
          required: true,
        },
        defaultValues: { credential: multiple ? [] : '' },
        fieldState: {
          validateStatus: FormItemValidateStatusEnum.Error,
          errors: ['Choose a credential'],
        },
        showCurrentValue: true,
      })

      const control = page.getByRole('combobox', { name: 'Credential' })
      await expect
        .element(control)
        .toHaveAccessibleDescription('Use the workspace credential Choose a credential')
      await page.getByText('Credential').click()
      await expect.element(control).toHaveFocus()
      await userEvent.keyboard('{ArrowDown}')
      await expect.element(page.getByRole('option', { name: 'Primary' })).toHaveFocus()
      await userEvent.keyboard('{Enter}')
      await expect
        .element(page.getByRole('status', { name: 'Field value' }))
        .toHaveTextContent('primary')
    },
  )

  it('shows loading while the service boundary is pending', async () => {
    const request = createDeferred<Awaited<ReturnType<typeof dynamicOptions>>>()
    dynamicOptions.mockReturnValue(request.promise)
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.dynamicSelect,
        dynamicSelectParams,
        name: 'plugin',
        label: 'Plugin',
        required: false,
      },
      defaultValues: { plugin: '' },
    })

    await expect.element(page.getByText('common.dynamicSelect.loading')).toBeVisible()
    request.resolve({ options: [{ label: { en_US: 'Ready' }, value: 'ready' }] })
    await expect.element(page.getByRole('combobox', { name: 'Plugin' })).toBeEnabled()
    await page.getByRole('combobox', { name: 'Plugin' }).click()
    await expect.element(page.getByRole('option', { name: 'Ready' })).toBeVisible()
  })

  it('renders translated service options and applies one', async () => {
    dynamicOptions.mockResolvedValue({
      options: [{ label: { en_US: 'Option A', zh_Hans: '选项A' }, value: 'a' }],
    })
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.dynamicSelect,
        dynamicSelectParams,
        name: 'plugin_option',
        label: 'Plugin option',
        required: false,
      },
      defaultValues: { plugin_option: '' },
      showCurrentValue: true,
    })

    await page.getByRole('combobox', { name: 'Plugin option' }).click()
    await page.getByRole('option', { name: 'Option A' }).click()
    await expect.element(page.getByRole('status', { name: 'Field value' })).toHaveTextContent('a')
    await expect
      .element(page.getByRole('combobox', { name: 'Plugin option' }))
      .toHaveTextContent('Option A')
  })

  it('preserves and extends multiple service values', async () => {
    dynamicOptions.mockResolvedValue({
      options: [
        { label: { en_US: 'Option A', zh_Hans: '选项A' }, value: 'a' },
        { label: { en_US: 'Option B', zh_Hans: '选项B' }, value: 'b' },
      ],
    })
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.dynamicSelect,
        dynamicSelectParams,
        name: 'plugin_options',
        label: 'Plugin options',
        required: false,
        multiple: true,
      },
      defaultValues: { plugin_options: ['a'] },
      showCurrentValue: true,
    })

    await expect
      .element(page.getByRole('combobox', { name: 'Plugin options' }))
      .toHaveTextContent('common.dynamicSelect.selected:{"count":1}')
    await page.getByRole('combobox', { name: 'Plugin options' }).click()
    await page.getByRole('option', { name: 'Option B' }).click()
    await expect.element(page.getByRole('status', { name: 'Field value' })).toHaveTextContent('a,b')
  })

  it('shows a service error without presenting options', async () => {
    dynamicOptions.mockRejectedValue(new Error('Failed'))
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.dynamicSelect,
        dynamicSelectParams,
        name: 'ds_error',
        label: 'DS Error',
        required: false,
      },
    })

    await page.getByRole('combobox', { name: 'DS Error' }).click()
    await expect.element(page.getByText('common.dynamicSelect.error')).toBeVisible()
    await expect.element(page.getByRole('option')).not.toBeInTheDocument()
  })

  it('shows an empty service result without presenting options', async () => {
    dynamicOptions.mockResolvedValue({ options: [] })
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.dynamicSelect,
        dynamicSelectParams,
        name: 'ds_empty',
        label: 'DS Empty',
        required: false,
      },
    })

    await page.getByRole('combobox', { name: 'DS Empty' }).click()
    await expect.element(page.getByText('common.dynamicSelect.noData')).toBeVisible()
    await expect.element(page.getByRole('option')).not.toBeInTheDocument()
  })
})

beforeEach(async () => {
  dynamicOptions.mockReset().mockResolvedValue({ options: [] })
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
})
