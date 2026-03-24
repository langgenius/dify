'use client'
import type { FC } from 'react'
import type { SchemaRoot } from '@/app/components/workflow/nodes/llm/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@/app/components/base/ui/dialog'
import VisualEditor from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/visual-editor'
import { MittProvider, VisualEditorContextProvider } from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/visual-editor/context'

type Props = {
  isShow: boolean
  schema: SchemaRoot
  rootName: string
  onClose: () => void
}

const SchemaModal: FC<Props> = ({
  isShow,
  schema,
  rootName,
  onClose,
}) => {
  const { t } = useTranslation()
  return (
    <Dialog open={isShow} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-[960px] p-0">
        <DialogCloseButton className="right-5 top-5 h-8 w-8 p-1.5" />
        <div className="pb-6">
          {/* Header */}
          <div className="relative flex p-6 pb-3 pr-14">
            <DialogTitle className="grow truncate text-text-primary title-2xl-semi-bold">
              {t('nodes.agent.parameterSchema', { ns: 'workflow' })}
            </DialogTitle>
          </div>
          {/* Content */}
          <div className="flex max-h-[700px] overflow-y-auto px-6 py-2">
            <MittProvider>
              <VisualEditorContextProvider>
                <VisualEditor
                  className="w-full"
                  schema={schema}
                  rootName={rootName}
                  readOnly
                >
                </VisualEditor>
              </VisualEditorContextProvider>
            </MittProvider>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(SchemaModal)
