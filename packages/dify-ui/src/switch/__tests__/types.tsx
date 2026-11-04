import type { SwitchProps } from '@langgenius/dify-ui/switch'
import { Switch } from '@langgenius/dify-ui/switch'
import * as React from 'react'

function SwitchTypeExamples() {
  const onCheckedChange: NonNullable<SwitchProps['onCheckedChange']> = (checked, details) => {
    if (checked) details.cancel()
  }

  return (
    <React.Fragment>
      <Switch defaultChecked onCheckedChange={onCheckedChange} />
      <Switch checked={false} onCheckedChange={(checked) => void checked} />
      {/* @ts-expect-error the composite owns its thumb and loading indicator */}
      <Switch>Custom thumb</Switch>
    </React.Fragment>
  )
}

void SwitchTypeExamples
