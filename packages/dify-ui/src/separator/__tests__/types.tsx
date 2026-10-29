import type * as React from 'react'
import { Separator } from '@langgenius/dify-ui/separator'

export function separatorTypeContracts(ref: React.Ref<HTMLDivElement>) {
  const decorative = <Separator decorative orientation="vertical" variant="gradient" />
  const semantic = <Separator ref={ref} />
  const render = (
    <Separator
      render={(props, state) => <div {...props} data-direction={state.orientation} />}
      style={(state) => ({ height: state.orientation === 'vertical' ? 24 : 1 })}
    />
  )
  const className = (
    <Separator className={(state) => (state.orientation === 'vertical' ? 'custom' : undefined)} />
  )
  // @ts-expect-error Orientation is inherited from Base UI.
  const orientation = <Separator orientation="diagonal" />
  return { decorative, semantic, render, className, orientation }
}
