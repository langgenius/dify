'use client'

import type { ShortcutPlatform } from '../shortcut-platform'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { Kbd } from '@langgenius/dify-ui/kbd'
import { detectPlatform, formatForDisplay } from '@tanstack/react-hotkeys'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { gotoAnythingDialogHandle } from '@/app/components/goto-anything/dialog-handle'
import { GOTO_ANYTHING_HOTKEY } from '@/app/components/goto-anything/hotkeys'

function noopSubscribe() {
  return () => {}
}

function getPlatformSnapshot() {
  return detectPlatform()
}

function useDisplayPlatform(initialPlatform: ShortcutPlatform | null) {
  return useSyncExternalStore(noopSubscribe, getPlatformSnapshot, () => initialPlatform)
}

export function MainNavSearchButton({
  initialPlatform = null,
}: {
  initialPlatform?: ShortcutPlatform | null
}) {
  const { t } = useTranslation()
  const displayPlatform = useDisplayPlatform(initialPlatform)
  const ariaKeyShortcuts =
    displayPlatform === null
      ? undefined
      : GOTO_ANYTHING_HOTKEY.replace('Mod', displayPlatform === 'mac' ? 'Meta' : 'Control')

  return (
    <DialogTrigger
      handle={gotoAnythingDialogHandle}
      render={
        <button
          type="button"
          aria-label={t(($) => $['gotoAnything.searchTitle'], { ns: 'app' })}
          aria-keyshortcuts={ariaKeyShortcuts}
          className="flex h-8 items-center gap-1.5 overflow-hidden rounded-[10px] p-2 text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        />
      }
    >
      <span aria-hidden className="i-custom-vender-main-nav-quick-search h-4 w-4" />
      <Kbd
        aria-hidden="true"
        data-pending={displayPlatform === null ? '' : undefined}
        className="h-4.5 min-w-0 shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary data-pending:invisible"
      >
        {displayPlatform !== null &&
          GOTO_ANYTHING_HOTKEY.split('+').map((key) => (
            <span key={key}>{formatForDisplay(key, { platform: displayPlatform })}</span>
          ))}
      </Kbd>
    </DialogTrigger>
  )
}
