import type { SwitchProps } from '@langgenius/dify-ui/switch'
import { Switch } from '@langgenius/dify-ui/switch'

function SwitchTypeExamples() {
  const onCheckedChange: NonNullable<SwitchProps['onCheckedChange']> = (checked, details) => {
    if (checked) details.cancel()
  }

  return (
    <>
      <Switch defaultChecked onCheckedChange={onCheckedChange} />
      <Switch checked={false} onCheckedChange={(checked) => void checked} />
      {/* @ts-expect-error the composite owns its thumb and loading indicator */}
      <Switch>Custom thumb</Switch>
    </>
  )
}

void SwitchTypeExamples
