import type { PreviewCardActions, PreviewCardProps } from '@langgenius/dify-ui/preview-card'
import { PreviewCard } from '@langgenius/dify-ui/preview-card'
import * as React from 'react'
import { expectTypeOf } from 'vite-plus/test'

export function previewCardActionsTypeContract() {
  const actionsRef = React.createRef<PreviewCardActions>()
  expectTypeOf(actionsRef.current).toEqualTypeOf<
    NonNullable<PreviewCardProps['actionsRef']>['current']
  >()
  return <PreviewCard actionsRef={actionsRef} />
}
