import type { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu'
import type {
  ContextMenuPopupProps,
  ContextMenuPortalProps,
  ContextMenuPositionerProps,
} from '@langgenius/dify-ui/context-menu'
import {
  ContextMenuPopup,
  ContextMenuPortal,
  ContextMenuPositioner,
} from '@langgenius/dify-ui/context-menu'
import * as React from 'react'
import { expectTypeOf } from 'vite-plus/test'

export function contextMenuAnatomyTypeContracts() {
  expectTypeOf<ContextMenuPortalProps>().toEqualTypeOf<BaseContextMenu.Portal.Props>()
  expectTypeOf<ContextMenuPositionerProps>().toEqualTypeOf<BaseContextMenu.Positioner.Props>()
  expectTypeOf<ContextMenuPopupProps>().toEqualTypeOf<BaseContextMenu.Popup.Props>()

  const container = React.createRef<HTMLDivElement>()
  const portal = React.createRef<HTMLDivElement>()
  const positioner = React.createRef<HTMLDivElement>()
  const popup = React.createRef<HTMLDivElement>()

  return (
    <ContextMenuPortal container={container} ref={portal} keepMounted>
      <ContextMenuPositioner
        ref={positioner}
        anchor={container}
        collisionAvoidance={{ side: 'flip', align: 'shift' }}
        className={(state) => {
          expectTypeOf(state).toEqualTypeOf<BaseContextMenu.Positioner.State>()
          return state.anchorHidden ? 'invisible' : ''
        }}
        style={(state) => ({ opacity: state.anchorHidden ? 0 : 1 })}
      >
        <ContextMenuPopup
          ref={popup}
          finalFocus={container}
          className={(state) => {
            expectTypeOf(state).toEqualTypeOf<BaseContextMenu.Popup.State>()
            return state.open ? 'opacity-100' : 'opacity-0'
          }}
          style={(state) => ({ opacity: state.open ? 1 : 0 })}
        />
      </ContextMenuPositioner>
    </ContextMenuPortal>
  )
}
