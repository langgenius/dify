import type * as React from 'react'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'

export function infotipTypeContracts(
  triggerRef: React.Ref<HTMLButtonElement>,
  popupRef: React.Ref<HTMLDivElement>,
) {
  const composition = (
    <Infotip<{ title: string }>>
      {({ payload }) => (
        <>
          <InfotipTrigger
            aria-label="Details"
            ref={triggerRef}
            payload={{ title: 'Details' }}
            iconVariant="information"
            iconSize="small"
            className={(state) => (state.open ? 'text-text-accent' : undefined)}
            style={(state) => ({ opacity: state.disabled ? 0.5 : 1 })}
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
        </>
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
  const state = (
    // @ts-expect-error Popup state is separate from trigger state.
    <InfotipContent className={(state) => String(state.disabled)}>Details</InfotipContent>
  )
  return { composition, labelledTrigger, unnamed, children, render, state }
}
