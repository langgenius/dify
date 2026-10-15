'use client'

import type { EndUserApp, RemoveAppRequest } from './model'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import MyApps from '.'
import { demoApps } from './demo-data'

export default function MyAppsDemo() {
  const { t } = useTranslation(['app', 'common'])
  const [apps, setApps] = useState<readonly EndUserApp[]>(demoApps)
  const [openedApp, setOpenedApp] = useState<EndUserApp | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const removeApp = ({ app }: RemoveAppRequest) => {
    // The sample apps have no chat history; both actions only change this in-memory list.
    setApps((current) => current.filter((item) => item.id !== app.id))
  }
  return (
    <>
      <MyApps
        apps={apps}
        onOpenApp={(app) => {
          setOpenedApp(app)
          setPreviewOpen(true)
          setApps((current) =>
            current.map((item) =>
              item.id === app.id ? { ...item, lastUsedAt: Date.now() } : item,
            ),
          )
        }}
        onToggleStar={(id) =>
          setApps((current) =>
            current.map((app) => (app.id === id ? { ...app, starred: !app.starred } : app)),
          )
        }
        onRemoveApp={removeApp}
      />
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent>
          <div className="flex items-start justify-between gap-4">
            <DialogTitle className="title-3xl-semi-bold text-text-primary">
              {openedApp?.name}
            </DialogTitle>
            <DialogClose
              render={
                <IconButton aria-label={t(($) => $['operation.close'], { ns: 'common' })}>
                  <span className="i-ri-close-line size-5" aria-hidden="true" />
                </IconButton>
              }
            />
          </div>
          <DialogDescription className="mt-3 system-md-regular text-text-tertiary">
            {t(($) => $['endUser.previewDescription'], { ns: 'app' })}
          </DialogDescription>
          <p className="mt-4 system-md-regular text-text-secondary">{openedApp?.description}</p>
        </DialogContent>
      </Dialog>
    </>
  )
}
