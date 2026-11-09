import type { ComponentProps } from 'react'
import { useState } from 'react'
import ParamItem from '..'

type Props = Omit<
  Partial<ComponentProps<typeof ParamItem>>,
  'id' | 'name' | 'onChange' | 'onSwitchChange'
>

// A caller applies the public value/key payloads; no owner transformation is copied here.
export function ParamItemExample({ value = 0.5, enable = true, max = 1, ...props }: Props) {
  const [values, setValues] = useState({ test_param: value })
  const [enabled, setEnabled] = useState({ test_param: enable })
  return (
    <>
      <ParamItem
        {...props}
        id="test_param"
        name="Test Param"
        max={max}
        value={values.test_param}
        enable={enabled.test_param}
        onChange={(key, next) => setValues((previous) => ({ ...previous, [key]: next }))}
        onSwitchChange={(key, next) => setEnabled((previous) => ({ ...previous, [key]: next }))}
      />
      <output aria-label="Saved parameters">{JSON.stringify(values)}</output>
      <output aria-label="Enabled parameters">{JSON.stringify(enabled)}</output>
    </>
  )
}
