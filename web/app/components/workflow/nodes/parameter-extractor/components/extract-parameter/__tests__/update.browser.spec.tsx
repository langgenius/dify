import type { Param } from '../../../types'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ChangeType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { AppToaster } from '@/app/notifications/app-toaster'
import { ParamType } from '../../../types'
import { ParameterDialog } from '../update'

const parameter = (overrides: Partial<Param> = {}): Param => ({
  name: 'city',
  type: ParamType.string,
  description: 'City name',
  required: false,
  ...overrides,
})
afterEach(() => toast.dismiss())
async function setup(payload?: Param) {
  const onSave = vi.fn()
  const screen = await render(
    <>
      <AppToaster timeout={0} />
      {payload ? (
        <ParameterDialog type="edit" payload={payload} onSave={onSave} />
      ) : (
        <ParameterDialog type="add" onSave={onSave} />
      )}
    </>,
  )
  const trigger = screen.getByRole('button', {
    name: payload
      ? `common.operation.edit ${payload.name}`
      : 'workflowModels.nodes.parameterExtractor.addExtractParameter',
    exact: true,
  })
  await trigger.click()
  const dialog = screen.getByRole('dialog', {
    name: payload
      ? `common.operation.edit ${payload.name}`.trim()
      : 'workflowModels.nodes.parameterExtractor.addExtractParameter',
    exact: true,
  })
  await expect.element(dialog).toBeVisible()
  const name = dialog.getByRole('textbox', { name: /Content.name$/ })
  const description = dialog.getByRole('textbox', { name: /Content.description$/ })
  const save = dialog.getByRole('button', {
    name: payload ? 'common.operation.save' : 'common.operation.add',
    exact: true,
  })
  return { screen, dialog, trigger, name, description, save, onSave }
}

it('adds a parameter through native form submission and returns focus to its trigger', async () => {
  const { dialog, trigger, name, description, save, onSave } = await setup()
  await name.fill('budget')
  await description.fill('Budget amount')
  await save.click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(onSave).toHaveBeenCalledExactlyOnceWith(
    parameter({ name: 'budget', description: 'Budget amount' }),
    undefined,
  )
})

it('rejects an invalid name through native input and explains why without saving', async () => {
  const { screen, dialog, name, onSave } = await setup()
  await name.fill('1bad')
  await expect.element(name).toHaveValue('')
  await expect.element(screen.getByRole('heading', { name: /varKeyError/ })).toBeVisible()
  await expect.element(dialog).toBeVisible()
  expect(onSave).not.toHaveBeenCalled()
})

it('keeps incomplete edits open, then accepts the corrected name and description', async () => {
  const { screen, dialog, name, description, save, onSave } = await setup(
    parameter({ name: '', description: '' }),
  )
  await save.click()
  await expect.element(screen.getByRole('heading', { name: /fieldRequired/ })).toBeVisible()
  await expect.element(dialog).toBeVisible()
  expect(onSave).not.toHaveBeenCalled()
  await name.fill('city')
  await description.fill('City name')
  await save.click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(onSave).toHaveBeenCalledExactlyOnceWith(parameter(), {
    type: ChangeType.changeVarName,
    payload: { beforeKey: '', afterKey: 'city' },
  })
})

it('requires at least one select option and saves the option entered in the real editor', async () => {
  const { screen, dialog, save, onSave } = await setup(
    parameter({ type: ParamType.select, options: [] }),
  )
  await save.click()
  await expect
    .element(screen.getByRole('heading', { name: /variableConfig.options/ }))
    .toBeVisible()
  await expect.element(dialog).toBeVisible()
  expect(onSave).not.toHaveBeenCalled()
  await dialog.getByRole('button', { name: 'appDebug.variableConfig.addOption' }).click()
  await dialog.getByRole('textbox', { name: 'appDebug.variableConfig.options 1' }).fill('Approved')
  await save.click()
  await expect.element(dialog).not.toBeInTheDocument()
  expect(onSave).toHaveBeenCalledExactlyOnceWith(
    parameter({ type: ParamType.select, options: ['Approved'] }),
    undefined,
  )
})

it('discards cancelled drafts and reopens with the latest parameter supplied by the caller', async () => {
  const { screen, dialog, trigger, name, onSave } = await setup(parameter())
  await name.fill('city_draft')
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await screen.rerender(
    <>
      <AppToaster timeout={0} />
      <ParameterDialog type="edit" payload={parameter({ name: 'country' })} onSave={onSave} />
    </>,
  )
  await screen.getByRole('button', { name: 'common.operation.edit country' }).click()
  await expect
    .element(screen.getByRole('textbox', { name: /Content.name$/ }))
    .toHaveValue('country')
  expect(onSave).not.toHaveBeenCalled()
})

it('submits the original rename source with edited fields when Enter activates the native form', async () => {
  const { dialog, name, description, onSave } = await setup(parameter())
  await name.fill('city_name')
  await description.fill('City name updated')
  await name.click()
  await userEvent.keyboard('{Enter}')
  await expect.element(dialog).not.toBeInTheDocument()
  expect(onSave).toHaveBeenCalledExactlyOnceWith(
    parameter({ name: 'city_name', description: 'City name updated' }),
    { type: ChangeType.changeVarName, payload: { beforeKey: 'city', afterKey: 'city_name' } },
  )
})
