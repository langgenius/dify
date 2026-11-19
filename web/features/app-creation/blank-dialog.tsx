'use client'

import type { AppType } from '@/app/components/apps/app-type'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppMetadataForm } from '@/app/components/app/app-metadata'
import { AppTypeLabel } from '@/app/components/app/type-selector'
import { APP_TYPES } from '@/app/components/apps/app-type'
import { AppCreationFlow } from './entry'

const blankApp = {
  name: '',
  description: '',
  icon_type: 'emoji',
  icon: '\u{1F916}',
  icon_background: '#FFEAD5',
  icon_url: null,
} as const

export default function BlankAppDialog({
  defaultMode,
  onClose,
  onCreateTemplate,
}: {
  defaultMode: AppType
  onClose: () => void
  onCreateTemplate: () => void
}) {
  const { t } = useTranslation(['app'])
  const [mode, setMode] = useState(defaultMode)
  const nameInputRef = useRef<HTMLInputElement>(null)

  return (
    <AppCreationFlow>
      {({ onCreateBlank, loading, error }) => (
        <Dialog
          open
          onOpenChange={(open, details) => {
            if (open) return
            if (loading) details.cancel()
            else onClose()
          }}
        >
          <DialogContent initialFocus={nameInputRef}>
            <AppMetadataForm
              operation="create"
              title={t(($) => $['newApp.startFromBlank'], { ns: 'app' })}
              appDetail={blankApp}
              nameInputRef={nameInputRef}
              isPending={loading}
              error={error}
              onSubmit={({ name, description, icon_type, icon, icon_background }) =>
                onCreateBlank(mode, { name, description, icon_type, icon, icon_background })
              }
            >
              <Select<AppType>
                value={mode}
                onValueChange={(value) => setMode(value ?? defaultMode)}
                disabled={loading}
              >
                <SelectLabel>{t(($) => $['studio.filters.types'], { ns: 'app' })}</SelectLabel>
                <SelectTrigger>
                  <AppTypeLabel type={mode} />
                </SelectTrigger>
                <SelectContent>
                  {APP_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      <AppTypeLabel type={type} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="ghost" disabled={loading} onClick={onCreateTemplate}>
                {t(($) => $['newApp.menu.startFromTemplate'], { ns: 'app' })}
              </Button>
            </AppMetadataForm>
          </DialogContent>
        </Dialog>
      )}
    </AppCreationFlow>
  )
}
