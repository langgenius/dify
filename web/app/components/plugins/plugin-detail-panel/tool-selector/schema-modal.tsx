'use client'
import type { FC } from 'react'
import React from 'react'
import Modal from '@/app/components/base/modal'
import VisualEditor from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/visual-editor'
import type { SchemaRoot } from '@/app/components/workflow/nodes/llm/types'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { MittProvider, VisualEditorContextProvider } from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/visual-editor/context'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'

const testSchema: SchemaRoot = {
    type: Type.object,
    properties: {
      after: {
          type: Type.string,
          description: 'The ID of the existing block that the new block should be appended after. If not provided, content will be appended at the end of the page.',
      },
      content_block: {
          type: Type.object,
          properties: {
              block_property: {
                  type: Type.string,
                  description: 'The block property of the block to be added. Possible property are `paragraph`,`heading_1`,`heading_2`,`heading_3`,`callout`,`todo`,`toggle`,`quote`, `bulleted_list_item`, `numbered_list_item`, other properties possible are `file`,`image`,`video` (link required).',
              },
              bold: {
                  type: Type.boolean,
                  description: 'Indicates if the text is bold.',
              },
              code: {
                  type: Type.boolean,
                  description: 'Indicates if the text is formatted as code.',
              },
              color: {
                  type: Type.string,
                  description: 'The color of the text background or text itself.',
              },
              content: {
                  anyOf: [
                      {
                          type: Type.string,
                      },
                      {
                          enum: [
                              'null',
                          ],
                          nullable: true,
                      },
                  ],
                  description: 'The textual content of the rich text object. Required for paragraph, heading_1, heading_2, heading_3, callout, todo, toggle, quote.',
              },
              italic: {
                  type: Type.boolean,
                  description: 'Indicates if the text is italic.',
              },
              link: {
                  type: Type.string,
                  description: 'The URL of the rich text object or the file to be uploaded or image/video link',
              },
              strikethrough: {
                  type: Type.boolean,
                  description: 'Indicates if the text has strikethrough.',
              },
              underline: {
                  type: Type.boolean,
                  description: 'Indicates if the text is underlined.',
              },
          },
          additionalProperties: false,
          description: 'Child content to append to a page.',
      },
      parent_block_id: {
          type: Type.string,
          description: 'The ID of the page which the children will be added.',
      },
  },
  required: [
      'content_block',
      'parent_block_id',
  ],
  additionalProperties: false,
}
type Props = {
  isShow: boolean
  onClose: () => void
}

const SchemaModal: FC<Props> = ({
  isShow,
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
                schema={testSchema}
                onChange={(schema: SchemaRoot) => {
                  console.log('Schema changed:', schema)
                }}
              ></VisualEditor>
            </VisualEditorContextProvider>
          </MittProvider>
        </div>
      </div>
    </Modal>
  )
}
export default React.memo(SchemaModal)
