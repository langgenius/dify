import type { InfotipActions, InfotipProps } from '@langgenius/dify-ui/infotip'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import * as React from 'react'
import { expectTypeOf } from 'vite-plus/test'

export function infotipTypeContracts(
  triggerRef: React.Ref<HTMLButtonElement>,
  popupRef: React.Ref<HTMLDivElement>,
) {
  const composition = (
    <Infotip<{ title: string }>>
      {({ payload }) => (
        <React.Fragment>
          <InfotipTrigger
            aria-label="Details"
            ref={triggerRef}
            payload={{ title: 'Details' }}
            iconVariant="information"
            iconSize="small"
            tone="warning"
            className={(state) => (state.open ? 'ml-1' : undefined)}
          />
          <InfotipContent
            ref={popupRef}
            aria-label="Details"
            placement="bottom-start"
            sideOffset={({ side }) => (side === 'top' ? 4 : 8)}
            className={(state) => (state.open ? 'w-60' : undefined)}
            style={(state) => ({ opacity: state.open ? 1 : 0 })}
          >
            {payload?.title}
          </InfotipContent>
        </React.Fragment>
      )}
    </Infotip>
  )
  const labelledTrigger = <InfotipTrigger aria-labelledby="visible-label" />
  // @ts-expect-error An icon-only trigger requires an accessible name.
  const unnamed = <InfotipTrigger />
  // @ts-expect-error The icon is owned by InfotipTrigger.
  const children = <InfotipTrigger aria-label="Details">Custom trigger</InfotipTrigger>
  // @ts-expect-error InfotipTrigger always renders a native button.
  const render = <InfotipTrigger aria-label="Details" render={<div />} />
  // @ts-expect-error InfotipTrigger owns its appearance; use className for external layout.
  const style = <InfotipTrigger aria-label="Details" style={{ color: 'red' }} />
  // @ts-expect-error Brand colors are local exceptions, not semantic tones.
  const accent = <InfotipTrigger aria-label="Details" tone="accent" />
  const state = (
    // @ts-expect-error Popup state is separate from trigger state.
    <InfotipContent className={(state) => String(state.disabled)}>Details</InfotipContent>
  )
  return { composition, labelledTrigger, unnamed, children, render, style, accent, state }
}

export function infotipActionsTypeContract() {
  const actionsRef = React.createRef<InfotipActions>()
  expectTypeOf(actionsRef.current).toEqualTypeOf<
    NonNullable<InfotipProps['actionsRef']>['current']
  >()
  return <Infotip actionsRef={actionsRef} />
}
