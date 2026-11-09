'use client'

import type { Plugin } from '../plugins/types'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
  DrawerVirtualKeyboardProvider,
} from '@langgenius/dify-ui/drawer'
import { useMediaQuery } from '@langgenius/dify-ui/use-media-query'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PluginInstallPermissionProvider } from '../plugins/install-plugin/components/plugin-install-permission-provider'
import useWorkspacePluginInstallPermission from '../plugins/install-plugin/hooks/use-workspace-plugin-install-permission'
import InstallFromMarketplace from '../plugins/install-plugin/install-from-marketplace'
import { gotoAnythingDialogHandle, gotoAnythingDrawerHandle } from './handles'
import { GOTO_ANYTHING_HOTKEY } from './hotkeys'
import { SearchSession } from './search-session'

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function GotoAnything() {
  const { t } = useTranslation(['app', 'common'])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const isAtLeastMd = useMediaQuery('(width >= 48rem)', {})
  if (isAtLeastMd && drawerOpen) setDrawerOpen(false)
  const [activePlugin, setActivePlugin] = useState<Plugin>()
  const { canInstallPlugin, currentDifyVersion } = useWorkspacePluginInstallPermission()
  const dialogInputRef = useRef<HTMLInputElement>(null)
  const drawerInputRef = useRef<HTMLInputElement>(null)

  useHotkey(
    GOTO_ANYTHING_HOTKEY,
    (event) => {
      if (event.defaultPrevented) return
      const isOpen = gotoAnythingDialogHandle.isOpen || drawerOpen
      if (!isOpen && isEditableShortcutTarget(event.target)) return

      event.preventDefault()
      event.stopPropagation()

      if (isOpen) return
      if (isAtLeastMd) gotoAnythingDialogHandle.open(null)
      else setDrawerOpen(true)
    },
    {
      ignoreInputs: false,
      preventDefault: false,
      stopPropagation: false,
    },
  )

  function closeSearch() {
    gotoAnythingDialogHandle.close()
    setDrawerOpen(false)
  }

  const searchTitle = t(($) => $['gotoAnything.searchTitle'], { ns: 'app' })
  const closeLabel = t(($) => $['operation.close'], { ns: 'common' })

  return (
    <>
      <Dialog handle={gotoAnythingDialogHandle}>
        <DialogContent
          initialFocus={dialogInputRef}
          className="w-140 data-open:transition-none"
          backdropProps={{ className: 'bg-background-overlay-alt data-open:transition-none' }}
        >
          <DialogTitle className="sr-only">{searchTitle}</DialogTitle>
          <SearchSession
            surface="dialog"
            inputRef={dialogInputRef}
            onClose={closeSearch}
            onInstallPlugin={setActivePlugin}
          />
          <DialogClose tabIndex={-1} className="sr-only">
            {closeLabel}
          </DialogClose>
        </DialogContent>
      </Dialog>

      <Drawer
        handle={gotoAnythingDrawerHandle}
        swipeDirection="down"
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      >
        <DrawerVirtualKeyboardProvider>
          <DrawerPortal>
            <DrawerBackdrop className="fixed bg-background-overlay-alt" />
            <DrawerViewport>
              <DrawerPopup
                initialFocus={drawerInputRef}
                className="h-[min(85dvh,calc(100dvh-3.5rem))]"
              >
                <DrawerTitle className="sr-only">{searchTitle}</DrawerTitle>
                <SearchSession
                  surface="drawer"
                  inputRef={drawerInputRef}
                  onClose={closeSearch}
                  onInstallPlugin={setActivePlugin}
                />
                <DrawerClose tabIndex={-1} className="sr-only">
                  {closeLabel}
                </DrawerClose>
              </DrawerPopup>
            </DrawerViewport>
          </DrawerPortal>
        </DrawerVirtualKeyboardProvider>
      </Drawer>

      {activePlugin && canInstallPlugin && (
        <PluginInstallPermissionProvider
          canInstallPlugin={canInstallPlugin}
          currentDifyVersion={currentDifyVersion}
        >
          <InstallFromMarketplace
            manifest={activePlugin}
            uniqueIdentifier={activePlugin.latest_package_identifier}
            onClose={() => setActivePlugin(undefined)}
            onSuccess={() => setActivePlugin(undefined)}
          />
        </PluginInstallPermissionProvider>
      )}
    </>
  )
}
