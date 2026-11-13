import type { Body, BodyPayload } from '../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { VarType } from '@/app/components/workflow/types'
import EditBody from '.'
import { BodyPayloadValueType, BodyType } from '../../types'
import { isSupportedHttpBodyVariable } from './supported-body-vars'

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: () => ({ availableVars: [], availableNodes: [] }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/input-support-select-var', () => ({
  default: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
  }) => (
    <input
      aria-label={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/prompt/editor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input
      aria-label="body-value"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({
    onChange,
    filterVar,
  }: {
    onChange: (value: string[]) => void
    filterVar?: (payload: { type: VarType }) => boolean
  }) => {
    filterVar?.({ type: VarType.file })
    filterVar?.({ type: VarType.string })

    return (
      <button type="button" onClick={() => onChange(['start-node', 'uploaded_file'])}>
        pick-file
      </button>
    )
  },
}))

const emptyRow = { type: BodyPayloadValueType.text, key: '', value: '' }

const initialBody: Body = {
  type: BodyType.xWwwFormUrlencoded,
  data: [{ id: 'body-row-1', ...emptyRow }],
}

function HttpBodySettings({ onSave }: { onSave: (body: Body) => void }) {
  const [payload, setPayload] = useState(initialBody)

  return (
    <EditBody
      nodeId="http-node"
      readonly={false}
      payload={payload}
      onChange={(next) => {
        onSave(next)
        setPayload(next)
      }}
    />
  )
}

const bodyRows = (body: Body) => body.data as BodyPayload

describe('HTTP body variable support', () => {
  it('should accept object and array object variables', () => {
    expect(isSupportedHttpBodyVariable(VarType.object)).toBe(true)
    expect(isSupportedHttpBodyVariable(VarType.arrayObject)).toBe(true)
  })

  it('should keep unsupported file variables excluded', () => {
    expect(isSupportedHttpBodyVariable(VarType.file)).toBe(false)
    expect(isSupportedHttpBodyVariable(VarType.arrayFile)).toBe(false)
  })
})

describe('HTTP body row editing', () => {
  it('should keep the value typed into the trailing row while appending the next row', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<HttpBodySettings onSave={onSave} />)

    const [keyInput, valueInput] = screen.getAllByRole('textbox')
    await user.type(keyInput!, 'name')
    await user.type(valueInput!, '1')

    const rows = bodyRows(onSave.mock.lastCall![0] as Body)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ key: 'name', value: '1' })
    expect(rows[1]).toMatchObject({ key: '', value: '' })
  })

  it('should keep the appended row editable after the first one is filled in', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<HttpBodySettings onSave={onSave} />)

    const [keyInput, valueInput] = screen.getAllByRole('textbox')
    await user.type(keyInput!, 'name')
    await user.type(valueInput!, '1')
    await user.type(screen.getAllByRole('textbox')[2]!, 'page')
    await user.type(screen.getAllByRole('textbox')[3]!, '2')

    const rows = bodyRows(onSave.mock.lastCall![0] as Body)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ key: 'name', value: '1' })
    expect(rows[1]).toMatchObject({ key: 'page', value: '2' })
  })
})

describe('HTTP body type switching', () => {
  it('should keep the JSON text typed after switching the body type', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<HttpBodySettings onSave={onSave} />)

    await user.click(screen.getByText('JSON'))
    fireEvent.change(screen.getByLabelText('body-value'), { target: { value: '{"a":1}' } })

    const body = onSave.mock.lastCall![0] as Body
    expect(body.type).toBe(BodyType.json)
    expect(bodyRows(body)[0]).toMatchObject({ value: '{"a":1}' })
  })

  it('should record the file variable selected for a binary body', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<HttpBodySettings onSave={onSave} />)

    await user.click(screen.getByText('binary'))
    await user.click(screen.getByRole('button', { name: 'pick-file' }))

    const body = onSave.mock.lastCall![0] as Body
    expect(body.type).toBe(BodyType.binary)
    expect(bodyRows(body)[0]).toMatchObject({ file: ['start-node', 'uploaded_file'] })
  })
})
