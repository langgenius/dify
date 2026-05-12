import type { VarType } from '../types'
import type { ChunkInfo } from '@/app/components/rag-pipeline/components/chunk-card-list/types'
import type { ParentMode } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import { ToggleGroup, ToggleGroupItem } from '@langgenius/dify-ui/toggle-group'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/app/components/base/markdown'
import Textarea from '@/app/components/base/textarea'
import { ChunkCardList } from '@/app/components/rag-pipeline/components/chunk-card-list'
import SchemaEditor from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/schema-editor'
import { ChunkingMode } from '@/models/datasets'
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

export function DisplayContent(props: DisplayContentProps) {
  const { previewType, varType, schemaType, mdString, jsonString, readonly, handleTextChange, handleEditorChange, className } = props
  const [viewMode, setViewMode] = useState<readonly ViewMode[]>([ViewMode.Code])
  const [isFocused, setIsFocused] = useState(false)
  const { t } = useTranslation()
  const viewOptions = [
    { value: ViewMode.Code, label: t('nodes.templateTransform.code', { ns: 'workflow' }), iconClassName: 'i-ri-braces-line' },
    { value: ViewMode.Preview, label: t('common.preview', { ns: 'workflow' }), iconClassName: 'i-ri-eye-line' },
  ]
  const selectedViewMode = viewMode[0] ?? ViewMode.Code

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
    <div className={cn('flex h-full flex-col rounded-[10px] bg-components-input-bg-normal', isFocused && 'bg-components-input-bg-active outline-1 outline-components-input-border-active outline-solid', className)}>
      <div className="flex shrink-0 items-center justify-end p-1">
        {previewType === PreviewType.Markdown && (
          <div className="flex grow items-center px-2 py-0.5 system-xs-semibold-uppercase text-text-secondary">
            {previewType.toUpperCase()}
          </div>
        )}
        {previewType === PreviewType.Chunks && (
          <div className="flex grow items-center px-2 py-0.5 system-xs-semibold-uppercase text-text-secondary">
            {varType.toUpperCase()}
            {schemaType ? `(${schemaType})` : ''}
          </div>
        )}
        <ToggleGroup<ViewMode>
          aria-label={t('common.preview', { ns: 'workflow' })}
          value={viewMode}
          onValueChange={setViewMode}
          className="shrink-0 rounded-md p-px"
        >
          {viewOptions.map(({ value, label, iconClassName }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="h-[22px] gap-[3px] rounded-md p-px pr-0.5 pl-1.5 text-text-tertiary data-pressed:text-text-accent-light-mode-only"
            >
              <i className={cn('size-4 shrink-0', iconClassName)} aria-hidden="true" />
              <span className="p-0.5 pr-1">{label}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex flex-1 overflow-auto rounded-b-[10px] pr-1 pl-3">
        {selectedViewMode === ViewMode.Code && (
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
        {selectedViewMode === ViewMode.Preview && (
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
