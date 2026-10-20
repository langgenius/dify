'use client'

import type { SaveConnectionValues } from '@/app/components/plugins/plugin-auth/connections/save-connection-modal'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SaveConnectionModal from '@/app/components/plugins/plugin-auth/connections/save-connection-modal'

export default function WorkspaceOAuthDemo() {
  const { t } = useTranslation(['plugin'])
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState(0)
  const [failNextSave, setFailNextSave] = useState(false)
  const [saved, setSaved] = useState<SaveConnectionValues>()

  return (
    <section
      aria-labelledby="workspace-oauth-demo"
      className="space-y-4 rounded-xl border border-divider-regular bg-components-panel-bg p-4"
    >
      <h2 id="workspace-oauth-demo" className="system-md-semibold text-text-primary">
        Workspace OAuth
      </h2>
      <p className="system-sm-regular text-text-secondary">
        Frontend demo: authorization has completed for demo@gmail.com. No OAuth request is made.
      </p>
      <Field>
        <FieldLabel className="flex items-center gap-2">
          <Checkbox checked={failNextSave} onCheckedChange={setFailNextSave} />
          Fail the next save
        </FieldLabel>
      </Field>
      <Button
        ref={triggerRef}
        onClick={() => {
          setSession((current) => current + 1)
          setOpen(true)
        }}
      >
        {t(($) => $['auth.connection.saveWithProvider'], { provider: 'Gmail' })}
      </Button>
      {saved && (
        <p role="status" className="system-sm-regular text-text-secondary">
          Saved: {saved.name}
        </p>
      )}
      {session > 0 && (
        <SaveConnectionModal
          key={session}
          open={open}
          onOpenChange={setOpen}
          providerName="Gmail"
          accountName="demo@gmail.com"
          defaultName="Workspace Gmail"
          finalFocus={triggerRef}
          dataSource={{
            save: async (values) => {
              if (failNextSave) {
                setFailNextSave(false)
                throw new Error('Demo save failed')
              }
              setSaved(values)
            },
          }}
        />
      )}
    </section>
  )
}
