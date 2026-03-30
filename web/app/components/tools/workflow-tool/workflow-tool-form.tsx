'use client'

import type { Emoji, WorkflowToolProviderOutputParameter, WorkflowToolProviderParameter } from '../types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import LabelSelector from '@/app/components/tools/labels/selector'
import { VarType } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'
import MethodSelector from './method-selector'

type WorkflowToolFormProps = {
  description: string
  emoji: Emoji
  isAdd?: boolean
  isNameValid: boolean
  labels: string[]
  name: string
  onDescriptionChange: (value: string) => void
  onEmojiClick: () => void
  onHide: () => void
  onLabelChange: (value: string[]) => void
  onNameChange: (value: string) => void
  onParameterChange: (key: 'description' | 'form', value: string, index: number) => void
  onPrimaryAction: () => void
  onPrivacyPolicyChange: (value: string) => void
  onRemove?: () => void
  onTitleChange: (value: string) => void
  outputParameters: WorkflowToolProviderOutputParameter[]
  parameters: WorkflowToolProviderParameter[]
  privacyPolicy: string
  title: string
}

const WorkflowToolForm = ({
  description,
  emoji,
  isAdd,
  isNameValid,
  labels,
  name,
  onDescriptionChange,
  onEmojiClick,
  onHide,
  onLabelChange,
  onNameChange,
  onParameterChange,
  onPrimaryAction,
  onPrivacyPolicyChange,
  onRemove,
  onTitleChange,
  outputParameters,
  parameters,
  privacyPolicy,
  title,
}: WorkflowToolFormProps) => {
  const { t } = useTranslation()
  const reservedOutputParameters = useMemo<WorkflowToolProviderOutputParameter[]>(() => ([
    {
      name: 'text',
      description: t('nodes.tool.outputVars.text', { ns: 'workflow' }),
      type: VarType.string,
      reserved: true,
    },
    {
      name: 'files',
      description: t('nodes.tool.outputVars.files.title', { ns: 'workflow' }),
      type: VarType.arrayFile,
      reserved: true,
    },
    {
      name: 'json',
      description: t('nodes.tool.outputVars.json', { ns: 'workflow' }),
      type: VarType.arrayObject,
      reserved: true,
    },
  ]), [t])
  const isOutputParameterReserved = (value: string) => reservedOutputParameters.some(item => item.name === value)
  const outputParameterRows = useMemo(() => {
    const seenKeys = new Map<string, number>()

    return [...reservedOutputParameters, ...outputParameters].map((item) => {
      const baseKey = [item.reserved ? 'reserved' : 'output', item.name, item.type ?? '', item.description].join(':')
      const occurrence = seenKeys.get(baseKey) ?? 0
      seenKeys.set(baseKey, occurrence + 1)

      return {
        item,
        key: occurrence === 0 ? baseKey : `${baseKey}:${occurrence}`,
      }
    })
  }, [outputParameters, reservedOutputParameters])

  return (
    <div className="flex h-full flex-col">
      <div className="h-0 grow space-y-4 overflow-y-auto px-6 py-3">
        <div>
          <div className="py-2 text-text-primary system-sm-medium">
            {t('createTool.name', { ns: 'tools' })}
            {' '}
            <span className="ml-1 text-red-500">*</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <AppIcon size="large" onClick={onEmojiClick} className="cursor-pointer" iconType="emoji" icon={emoji.content} background={emoji.background} />
            <Input
              className="h-10 grow"
              placeholder={t('createTool.toolNamePlaceHolder', { ns: 'tools' })!}
              value={title}
              onChange={e => onTitleChange(e.target.value)}
            />
          </div>
        </div>
        <div>
          <div className="flex items-center py-2 text-text-primary system-sm-medium">
            {t('createTool.nameForToolCall', { ns: 'tools' })}
            {' '}
            <span className="ml-1 text-red-500">*</span>
            <Tooltip>
              <TooltipTrigger render={<span aria-hidden className="i-ri-question-line ml-1 h-3.5 w-3.5 shrink-0 text-text-quaternary hover:text-text-tertiary" />} />
              <TooltipContent>
                <div className="w-[180px]">
                  {t('createTool.nameForToolCallPlaceHolder', { ns: 'tools' })}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
          <Input
            className="h-10"
            placeholder={t('createTool.nameForToolCallPlaceHolder', { ns: 'tools' })!}
            value={name}
            onChange={e => onNameChange(e.target.value)}
          />
          {!isNameValid && (
            <div className="text-xs leading-[18px] text-red-500">{t('createTool.nameForToolCallTip', { ns: 'tools' })}</div>
          )}
        </div>
        <div>
          <div className="py-2 text-text-primary system-sm-medium">{t('createTool.description', { ns: 'tools' })}</div>
          <Textarea
            placeholder={t('createTool.descriptionPlaceholder', { ns: 'tools' }) || ''}
            value={description}
            onChange={e => onDescriptionChange(e.target.value)}
          />
        </div>
        <div>
          <div className="py-2 text-text-primary system-sm-medium">{t('createTool.toolInput.title', { ns: 'tools' })}</div>
          <div className="w-full overflow-x-auto rounded-lg border border-divider-regular">
            <table className="w-full text-xs font-normal leading-[18px] text-text-secondary">
              <thead className="uppercase text-text-tertiary">
                <tr className="border-b border-divider-regular">
                  <th className="w-[156px] p-2 pl-3 font-medium">{t('createTool.toolInput.name', { ns: 'tools' })}</th>
                  <th className="w-[102px] p-2 pl-3 font-medium">{t('createTool.toolInput.method', { ns: 'tools' })}</th>
                  <th className="p-2 pl-3 font-medium">{t('createTool.toolInput.description', { ns: 'tools' })}</th>
                </tr>
              </thead>
              <tbody>
                {parameters.map((item, index) => (
                  <tr key={item.name} className="border-b border-divider-regular last:border-0">
                    <td className="max-w-[156px] p-2 pl-3">
                      <div className="text-[13px] leading-[18px]">
                        <div title={item.name} className="flex">
                          <span className="truncate font-medium text-text-primary">{item.name}</span>
                          <span className="shrink-0 pl-1 text-xs leading-[18px] text-[#ec4a0a]">{item.required ? t('createTool.toolInput.required', { ns: 'tools' }) : ''}</span>
                        </div>
                        <div className="text-text-tertiary">{item.type}</div>
                      </div>
                    </td>
                    <td>
                      {item.name === '__image'
                        ? (
                            <div className={cn('flex h-9 min-h-[56px] cursor-default items-center gap-1 bg-transparent px-3 py-2')}>
                              <div className={cn('grow truncate text-[13px] leading-[18px] text-text-secondary')}>
                                {t('createTool.toolInput.methodParameter', { ns: 'tools' })}
                              </div>
                            </div>
                          )
                        : (
                            <MethodSelector value={item.form} onChange={value => onParameterChange('form', value, index)} />
                          )}
                    </td>
                    <td className="w-[236px] p-2 pl-3 text-text-tertiary">
                      <input
                        type="text"
                        className="w-full appearance-none bg-transparent text-[13px] font-normal leading-[18px] text-text-secondary caret-primary-600 outline-none placeholder:text-text-quaternary"
                        placeholder={t('createTool.toolInput.descriptionPlaceholder', { ns: 'tools' })!}
                        value={item.description}
                        onChange={e => onParameterChange('description', e.target.value, index)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="py-2 text-text-primary system-sm-medium">{t('createTool.toolOutput.title', { ns: 'tools' })}</div>
          <div className="w-full overflow-x-auto rounded-lg border border-divider-regular">
            <table className="w-full text-xs font-normal leading-[18px] text-text-secondary">
              <thead className="uppercase text-text-tertiary">
                <tr className="border-b border-divider-regular">
                  <th className="w-[156px] p-2 pl-3 font-medium">{t('createTool.name', { ns: 'tools' })}</th>
                  <th className="p-2 pl-3 font-medium">{t('createTool.toolOutput.description', { ns: 'tools' })}</th>
                </tr>
              </thead>
              <tbody>
                {outputParameterRows.map(({ item, key }) => (
                  <tr key={key} className="border-b border-divider-regular last:border-0">
                    <td className="max-w-[156px] p-2 pl-3">
                      <div className="text-[13px] leading-[18px]">
                        <div title={item.name} className="flex items-center">
                          <span className="truncate font-medium text-text-primary">{item.name}</span>
                          <span className="shrink-0 pl-1 text-xs leading-[18px] text-[#ec4a0a]">{item.reserved ? t('createTool.toolOutput.reserved', { ns: 'tools' }) : ''}</span>
                          {!item.reserved && isOutputParameterReserved(item.name) && (
                            <Tooltip>
                              <TooltipTrigger render={<span aria-hidden className="i-ri-error-warning-line h-3 w-3 text-text-warning-secondary" />} />
                              <TooltipContent>
                                <div className="w-[180px]">
                                  {t('createTool.toolOutput.reservedParameterDuplicateTip', { ns: 'tools' })}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <div className="text-text-tertiary">{item.type}</div>
                      </div>
                    </td>
                    <td className="w-[236px] p-2 pl-3 text-text-tertiary">
                      <span className="text-[13px] font-normal leading-[18px] text-text-secondary">{item.description}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="py-2 text-text-primary system-sm-medium">{t('createTool.toolInput.label', { ns: 'tools' })}</div>
          <LabelSelector value={labels} onChange={onLabelChange} />
        </div>
        <div>
          <div className="py-2 text-text-primary system-sm-medium">{t('createTool.privacyPolicy', { ns: 'tools' })}</div>
          <Input
            className="h-10"
            value={privacyPolicy}
            onChange={e => onPrivacyPolicyChange(e.target.value)}
            placeholder={t('createTool.privacyPolicyPlaceholder', { ns: 'tools' }) || ''}
          />
        </div>
      </div>
      <div className={cn((!isAdd && onRemove) ? 'justify-between' : 'justify-end', 'mt-2 flex shrink-0 rounded-b-[10px] border-t border-divider-regular bg-background-section-burn px-6 py-4')}>
        {!isAdd && onRemove && (
          <Button variant="warning" onClick={onRemove}>{t('operation.delete', { ns: 'common' })}</Button>
        )}
        <div className="flex space-x-2">
          <Button onClick={onHide}>{t('operation.cancel', { ns: 'common' })}</Button>
          <Button variant="primary" onClick={onPrimaryAction}>
            {t('operation.save', { ns: 'common' })}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default WorkflowToolForm
