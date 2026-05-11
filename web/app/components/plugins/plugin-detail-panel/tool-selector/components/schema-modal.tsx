'use client'
import type { FC } from 'react'
import type { SchemaRoot } from '@/app/components/workflow/nodes/llm/types'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
    <Dialog
      open={isShow}
      onOpenChange={open => !open && onClose()}
    >
      <DialogContent className="w-full max-w-[960px] p-0">
        <div className="pb-6">
          {/* Header */}
          <div className="relative flex p-6 pr-14 pb-3">
            <DialogTitle className="grow truncate title-2xl-semi-bold text-text-primary">
              {t('nodes.agent.parameterSchema', { ns: 'workflow' })}
            </DialogTitle>
            <button
              type="button"
              aria-label={t('operation.close', { ns: 'common' })}
              className="absolute top-5 right-5 flex h-8 w-8 items-center justify-center p-1.5"
              onClick={onClose}
            >
              <span className="i-ri-close-line h-[18px] w-[18px] text-text-tertiary" />
            </button>
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
