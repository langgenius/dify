import React, { type FC, useCallback, useState } from 'react'
import Modal from '../../../../../base/modal'
import { type Field, Type } from '../../types'
import { RiBracesLine, RiCloseLine, RiExternalLinkLine, RiTimelineView } from '@remixicon/react'
import { SegmentedControl } from '../../../../../base/segmented-control'
import JsonSchemaGenerator from './json-schema-generator'
import Divider from '@/app/components/base/divider'
import JsonImporter from './json-importer'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import VisualEditor from './visual-editor'
import SchemaEditor from './schema-editor'

type JsonSchemaConfigModalProps = {
  isShow: boolean
  defaultSchema?: Field
  onSave: (schema: Field) => void
  onClose: () => void
}

enum SchemaView {
  VisualEditor = 'visualEditor',
  JsonSchema = 'jsonSchema',
}

const VIEW_TABS = [
  { Icon: RiTimelineView, text: 'Visual Editor', value: SchemaView.VisualEditor },
  { Icon: RiBracesLine, text: 'JSON Schema', value: SchemaView.JsonSchema },
]

const DEFAULT_SCHEMA: Field = {
  type: Type.object,
  properties: {},
  required: [],
  additionalProperties: false,
}

const JsonSchemaConfigModal: FC<JsonSchemaConfigModalProps> = ({
  isShow,
  defaultSchema,
  onSave,
  onClose,
}) => {
  const { t } = useTranslation()
  const [currentTab, setCurrentTab] = useState(SchemaView.VisualEditor)
  const [jsonSchema, setJsonSchema] = useState(defaultSchema || DEFAULT_SCHEMA)
  const [json, setJson] = useState(JSON.stringify(jsonSchema, null, 2))
  const [btnWidth, setBtnWidth] = useState(0)

  const updateBtnWidth = useCallback((width: number) => {
    setBtnWidth(width + 32)
  }, [])

  const handleApplySchema = useCallback(() => {}, [])

  const handleSubmit = useCallback(() => {}, [])

  const handleUpdateSchema = useCallback((schema: Field) => {
    setJsonSchema(schema)
  }, [])

  const handleSchemaEditorUpdate = useCallback((schema: string) => {
    setJson(schema)
  }, [])

  const handleResetDefaults = useCallback(() => {
    setJsonSchema(defaultSchema || DEFAULT_SCHEMA)
  }, [defaultSchema])

  const handleCancel = useCallback(() => {
    onClose()
  }, [onClose])

  const handleSave = useCallback(() => {
    onSave(jsonSchema)
    onClose()
  }, [jsonSchema, onSave, onClose])

  return (
    <Modal
      isShow={isShow}
      onClose={onClose}
      className='max-w-[960px] h-[800px] p-0'
    >
      <div className='flex flex-col h-full'>
        {/* Header */}
        <div className='relative flex p-6 pr-14 pb-3'>
          <div className='text-text-primary title-2xl-semi-bold grow truncate'>
            {t('workflow.nodes.llm.jsonSchema.title')}
          </div>
          <div className='absolute right-5 top-5 w-8 h-8 flex justify-center items-center p-1.5' onClick={() => onClose()}>
            <RiCloseLine className='w-[18px] h-[18px] text-text-tertiary' />
          </div>
        </div>
        {/* Content */}
        <div className='flex items-center justify-between px-6 py-2'>
          {/* Tab */}
          <SegmentedControl<SchemaView>
            options={VIEW_TABS}
            value={currentTab}
            onChange={(value: SchemaView) => {
              setCurrentTab(value)
            }}
          />
          <div className='flex items-center gap-x-0.5'>
            {/* JSON Schema Generator */}
            <JsonSchemaGenerator
              crossAxisOffset={btnWidth}
              onApply={handleApplySchema}
            />
            <Divider type='vertical' className='h-3' />
            {/* JSON Schema Importer */}
            <JsonImporter
              updateBtnWidth={updateBtnWidth}
              onSubmit={handleSubmit}
            />
          </div>
        </div>
        <div className='px-6 grow'>
          {currentTab === SchemaView.VisualEditor && (
            <VisualEditor
              schema={jsonSchema}
              onChange={handleUpdateSchema}
            />
          )}
          {currentTab === SchemaView.JsonSchema && (
            <SchemaEditor
              schema={json}
              onUpdate={handleSchemaEditorUpdate}
            />
          )}
        </div>
        {/* Footer */}
        <div className='flex items-center p-6 pt-5 gap-x-2'>
          <a
            className='flex items-center gap-x-1 grow text-text-accent'
            href='https://json-schema.org/'
            target='_blank'
            rel='noopener noreferrer'
          >
            <span className='system-xs-regular'>{t('workflow.nodes.llm.jsonSchema.doc')}</span>
            <RiExternalLinkLine className='w-3 h-3' />
          </a>
          <div className='flex items-center gap-x-3'>
            <div className='flex items-center gap-x-2'>
              <Button variant='secondary' onClick={handleResetDefaults}>
                {t('workflow.nodes.llm.jsonSchema.resetDefaults')}
              </Button>
              <Divider type='vertical' className='h-4 ml-1 mr-0' />
            </div>
            <div className='flex items-center gap-x-2'>
              <Button variant='secondary' onClick={handleCancel}>
                {t('common.operation.cancel')}
              </Button>
              <Button variant='primary' onClick={handleSave}>
                {t('common.operation.save')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default JsonSchemaConfigModal
