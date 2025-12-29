import type { VarType } from '../types'
import type { ChunkInfo } from '@/app/components/rag-pipeline/components/chunk-card-list/types'
import type { ParentMode } from '@/models/datasets'
import { RiBracesLine, RiEyeLine } from '@remixicon/react'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/app/components/base/markdown'
import { SegmentedControl } from '@/app/components/base/segmented-control'
import Textarea from '@/app/components/base/textarea'
import { ChunkCardList } from '@/app/components/rag-pipeline/components/chunk-card-list'
import SchemaEditor from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/schema-editor'
import { ChunkingMode } from '@/models/datasets'
import { cn } from '@/utils/classnames'
import { PreviewType, ViewMode } from './types'

type DisplayContentProps = {
  previewType: PreviewType
  varType: VarType
  schemaType?: string
  mdString?: string
  jsonString?: string
  readonly: boolean
  handleTextChange?: (value: string) => void
  handleEditorChange?: (value: string) => void
  className?: string
}

const DisplayContent = (props: DisplayContentProps) => {
  const { previewType, varType, schemaType, mdString, jsonString, readonly, handleTextChange, handleEditorChange, className } = props
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Code)
  const [isFocused, setIsFocused] = useState(false)
  const { t } = useTranslation()

  const chunkType = useMemo(() => {
    if (previewType !== PreviewType.Chunks || !schemaType)
      return undefined
    if (schemaType === 'general_structure')
      return ChunkingMode.text
    if (schemaType === 'parent_child_structure')
      return ChunkingMode.parentChild
    if (schemaType === 'qa_structure')
      return ChunkingMode.qa
  }, [previewType, schemaType])

  const parentMode = useMemo(() => {
    if (previewType !== PreviewType.Chunks || !schemaType || !jsonString)
      return undefined
    if (schemaType === 'parent_child_structure')
      return JSON.parse(jsonString!)?.parent_mode as ParentMode
    return undefined
  }, [previewType, schemaType, jsonString])

  return (
    <div className={cn('flex h-full flex-col rounded-[10px] bg-components-input-bg-normal', isFocused && 'bg-components-input-bg-active outline outline-1 outline-components-input-border-active', className)}>
      <div className="flex shrink-0 items-center justify-end p-1">
        {previewType === PreviewType.Markdown && (
          <div className="system-xs-semibold-uppercase flex grow items-center px-2 py-0.5 text-text-secondary">
            {previewType.toUpperCase()}
          </div>
        )}
        {previewType === PreviewType.Chunks && (
          <div className="system-xs-semibold-uppercase flex grow items-center px-2 py-0.5 text-text-secondary">
            {varType.toUpperCase()}
            {schemaType ? `(${schemaType})` : ''}
          </div>
        )}
        <SegmentedControl
          options={[
            { value: ViewMode.Code, text: t('nodes.templateTransform.code', { ns: 'workflow' }), Icon: RiBracesLine },
            { value: ViewMode.Preview, text: t('common.preview', { ns: 'workflow' }), Icon: RiEyeLine },
          ]}
          value={viewMode}
          onChange={setViewMode}
          size="small"
          padding="with"
          activeClassName="!text-text-accent-light-mode-only"
          btnClassName="!pl-1.5 !pr-0.5 gap-[3px]"
          className="shrink-0"
        />
      </div>
      <div className="flex flex-1 overflow-auto rounded-b-[10px] pl-3 pr-1">
        {viewMode === ViewMode.Code && (
          previewType === PreviewType.Markdown
            ? (
                <Textarea
                  readOnly={readonly}
                  disabled={readonly}
                  className="h-full border-none bg-transparent p-0 text-text-secondary hover:bg-transparent focus:bg-transparent focus:shadow-none"
                  value={mdString as any}
                  onChange={e => handleTextChange?.(e.target.value)}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                />
              )
            : (
                <SchemaEditor
                  readonly={readonly}
                  className="overflow-y-auto bg-transparent"
                  hideTopMenu
                  schema={jsonString!}
                  onUpdate={handleEditorChange!}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                />
              )
        )}
        {viewMode === ViewMode.Preview && (
          previewType === PreviewType.Markdown
            ? <Markdown className="grow overflow-auto rounded-lg px-4 py-3" content={(mdString ?? '') as string} />
            : (
                <ChunkCardList
                  chunkType={chunkType!}
                  parentMode={parentMode}
                  chunkInfo={JSON.parse(jsonString!) as ChunkInfo}
                />
              )
        )}
      </div>
    </div>
  )
}

export default React.memo(DisplayContent)
