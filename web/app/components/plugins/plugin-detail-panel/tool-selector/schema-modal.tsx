'use client'
import type { FC } from 'react'
import React from 'react'
import Modal from '@/app/components/base/modal'
import VisualEditor from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/visual-editor'
import type { SchemaRoot } from '@/app/components/workflow/nodes/llm/types'
import { MittProvider, VisualEditorContextProvider } from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/visual-editor/context'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'

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
    <Modal
      isShow={isShow}
      onClose={onClose}
      className='max-w-[960px] p-0'
      wrapperClassName='z-[9999]'
    >
      <div className='pb-6'>
        {/* Header */}
        <div className='relative flex p-6 pb-3 pr-14'>
          <div className='title-2xl-semi-bold grow truncate text-text-primary'>
            {t('workflow.nodes.agent.parameterSchema')}
          </div>
          <div className='absolute right-5 top-5 flex h-8 w-8 items-center justify-center p-1.5' onClick={onClose}>
            <RiCloseLine className='h-[18px] w-[18px] text-text-tertiary' />
          </div>
        </div>
        {/* Content */}
        <div className='flex max-h-[700px] overflow-y-auto px-6 py-2'>
          <MittProvider>
            <VisualEditorContextProvider>
              <VisualEditor
                className='w-full'
                schema={schema}
                rootName={rootName}
                readOnly
              ></VisualEditor>
            </VisualEditorContextProvider>
          </MittProvider>
        </div>
      </div>
    </Modal>
  )
}
export default React.memo(SchemaModal)
