import type { ReactNode } from 'react'
import type { ObjectValueItem } from './variable-modal.helpers'
import { RiDraftLine, RiInputField } from '@remixicon/react'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { ChatVarType } from '../type'
import ArrayBoolList from './array-bool-list'
import ArrayValueList from './array-value-list'
import BoolValue from './bool-value'
import ObjectValueList from './object-value-list'
import VariableTypeSelector from './variable-type-select'

type SectionTitleProps = {
  children: ReactNode
}

export const SectionTitle = ({ children }: SectionTitleProps) => (
  <div className="mb-1 flex h-6 items-center text-text-secondary system-sm-semibold">{children}</div>
)

type NameSectionProps = {
  name: string
  onBlur: (value: string) => void
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder: string
  title: string
}

export const NameSection = ({
  name,
  onBlur,
  onChange,
  placeholder,
  title,
}: NameSectionProps) => (
  <div className="mb-4">
    <SectionTitle>{title}</SectionTitle>
    <div className="flex">
      <Input
        placeholder={placeholder}
        value={name}
        onChange={onChange}
        onBlur={e => onBlur(e.target.value)}
        type="text"
      />
    </div>
  </div>
)

type TypeSectionProps = {
  list: ChatVarType[]
  onSelect: (value: ChatVarType) => void
  title: string
  type: ChatVarType
}

export const TypeSection = ({
  list,
  onSelect,
  title,
  type,
}: TypeSectionProps) => (
  <div className="mb-4">
    <SectionTitle>{title}</SectionTitle>
    <div className="flex">
      <VariableTypeSelector
        value={type}
        list={list}
        onSelect={onSelect}
        popupClassName="w-[327px]"
      />
    </div>
  </div>
)

type ValueSectionProps = {
  editorContent?: string
  editorMinHeight: string
  editInJSON: boolean
  objectValue: ObjectValueItem[]
  onArrayBoolChange: (value: boolean[]) => void
  onArrayChange: (value: Array<string | number | undefined>) => void
  onEditorChange: (nextEditInJson: boolean) => void
  onEditorValueChange: (content: string) => void
  onObjectChange: (value: ObjectValueItem[]) => void
  onValueChange: (value: boolean) => void
  placeholder: ReactNode
  t: (key: string, options?: Record<string, unknown>) => string
  toggleLabelKey?: string
  type: ChatVarType
  value: unknown
}

export const ValueSection = ({
  editorContent,
  editorMinHeight,
  editInJSON,
  objectValue,
  onArrayBoolChange,
  onArrayChange,
  onEditorChange,
  onEditorValueChange,
  onObjectChange,
  onValueChange,
  placeholder,
  t,
  toggleLabelKey,
  type,
  value,
}: ValueSectionProps) => (
  <div className="mb-4">
    <div className="mb-1 flex h-6 items-center justify-between text-text-secondary system-sm-semibold">
      <div>{t('chatVariable.modal.value', { ns: 'workflow' })}</div>
      {toggleLabelKey && (
        <Button
          variant="ghost"
          size="small"
          className="text-text-tertiary"
          onClick={() => onEditorChange(!editInJSON)}
        >
          {editInJSON ? <RiInputField className="mr-1 h-3.5 w-3.5" /> : <RiDraftLine className="mr-1 h-3.5 w-3.5" />}
          {t(toggleLabelKey, { ns: 'workflow' })}
        </Button>
      )}
    </div>
    <div className="flex">
      {type === ChatVarType.String && (
        <textarea
          className="block h-20 w-full resize-none appearance-none rounded-lg border border-transparent bg-components-input-bg-normal p-2 text-components-input-text-filled caret-primary-600 outline-none system-sm-regular placeholder:text-components-input-text-placeholder placeholder:system-sm-regular hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs"
          value={(value as string) || ''}
          placeholder={t('chatVariable.modal.valuePlaceholder', { ns: 'workflow' }) || ''}
          onChange={e => onArrayChange([e.target.value])}
        />
      )}
      {type === ChatVarType.Number && (
        <Input
          placeholder={t('chatVariable.modal.valuePlaceholder', { ns: 'workflow' }) || ''}
          value={value as number | undefined}
          onChange={(e) => {
            const rawValue = e.target.value
            onArrayChange([rawValue === '' ? undefined : Number(rawValue)])
          }}
          type="number"
        />
      )}
      {type === ChatVarType.Boolean && (
        <BoolValue
          value={value as boolean}
          onChange={onValueChange}
        />
      )}
      {type === ChatVarType.Object && !editInJSON && (
        <ObjectValueList
          list={objectValue}
          onChange={onObjectChange}
        />
      )}
      {type === ChatVarType.ArrayString && !editInJSON && (
        <ArrayValueList
          isString
          list={(value as Array<string | undefined>) || [undefined]}
          onChange={onArrayChange}
        />
      )}
      {type === ChatVarType.ArrayNumber && !editInJSON && (
        <ArrayValueList
          isString={false}
          list={(value as Array<number | undefined>) || [undefined]}
          onChange={onArrayChange}
        />
      )}
      {type === ChatVarType.ArrayBoolean && !editInJSON && (
        <ArrayBoolList
          list={(value as boolean[]) || [true]}
          onChange={onArrayBoolChange}
        />
      )}
      {editInJSON && (
        <div className="w-full rounded-[10px] bg-components-input-bg-normal py-2 pl-3 pr-1" style={{ height: editorMinHeight }}>
          <CodeEditor
            isExpand
            noWrapper
            language={CodeLanguage.json}
            value={editorContent}
            placeholder={<div className="whitespace-pre">{placeholder}</div>}
            onChange={onEditorValueChange}
          />
        </div>
      )}
    </div>
  </div>
)

type DescriptionSectionProps = {
  description: string
  onChange: (value: string) => void
  placeholder: string
  title: string
}

export const DescriptionSection = ({
  description,
  onChange,
  placeholder,
  title,
}: DescriptionSectionProps) => (
  <div>
    <SectionTitle>{title}</SectionTitle>
    <div className="flex">
      <textarea
        className="block h-20 w-full resize-none appearance-none rounded-lg border border-transparent bg-components-input-bg-normal p-2 text-components-input-text-filled caret-primary-600 outline-none system-sm-regular placeholder:text-components-input-text-placeholder placeholder:system-sm-regular hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs"
        value={description}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  </div>
)
