'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { produce } from 'immer'
import type { Emoji, WorkflowToolProviderOutputParameter, WorkflowToolProviderParameter, WorkflowToolProviderRequest } from '../types'
import cn from '@/utils/classnames'
import Drawer from '@/app/components/base/drawer-plus'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import EmojiPicker from '@/app/components/base/emoji-picker'
import AppIcon from '@/app/components/base/app-icon'
import MethodSelector from '@/app/components/tools/workflow-tool/method-selector'
import LabelSelector from '@/app/components/tools/labels/selector'
import ConfirmModal from '@/app/components/tools/workflow-tool/confirm-modal'
import Tooltip from '@/app/components/base/tooltip'
import { VarType } from '@/app/components/workflow/types'

type Props = {
  isAdd?: boolean
  payload: any
  onHide: () => void
  onRemove?: () => void
  onCreate?: (payload: WorkflowToolProviderRequest & { workflow_app_id: string }) => void
  onSave?: (payload: WorkflowToolProviderRequest & Partial<{
    workflow_app_id: string
    workflow_tool_id: string
  }>) => void
}
// Add and Edit
const WorkflowToolAsModal: FC<Props> = ({
  isAdd,
  payload,
  onHide,
  onRemove,
  onSave,
  onCreate,
}) => {
  const { t } = useTranslation()

  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false)
  const [emoji, setEmoji] = useState<Emoji>(payload.icon)
  const [label, setLabel] = useState<string>(payload.label)
  const [name, setName] = useState(payload.name)
  const [description, setDescription] = useState(payload.description)
  const [parameters, setParameters] = useState<WorkflowToolProviderParameter[]>(payload.parameters)
  const [outputParameters, setOutputParameters] = useState<WorkflowToolProviderOutputParameter[]>(payload.outputParameters)

  const reservedOutputParameters: WorkflowToolProviderOutputParameter[] = [
    {
      name: 'text',
      description: t('workflow.nodes.tool.outputVars.text'),
      type: VarType.string,
      reserved: true,
    },
    {
      name: 'files',
      description: t('workflow.nodes.tool.outputVars.files.title'),
      type: VarType.arrayFile,
      reserved: true,
    },
    {
      name: 'json',
      description: t('workflow.nodes.tool.outputVars.json'),
      type: VarType.arrayObject,
      reserved: true,
    },
  ]
  const handleInputParameterChange = <K extends keyof WorkflowToolProviderParameter>(
    key: K,
    value: WorkflowToolProviderParameter[K],
    index: number,
  ) => {
    const newData = produce(parameters, (draft: WorkflowToolProviderParameter[]) => {
      draft[index][key] = value
    })
    setParameters(newData)
  }

  const handleOutputParameterChange = <K extends keyof WorkflowToolProviderOutputParameter>(
    key: K,
    value: WorkflowToolProviderOutputParameter[K],
    index: number,
  ) => {
    const newData = produce(outputParameters, (draft: WorkflowToolProviderOutputParameter[]) => {
      draft[index][key] = value
    })
    setOutputParameters(newData)
  }

  const handleParameterChange = (
    type: 'input' | 'output',
    key: string,
    value: any,
    index: number,
  ) => {
    if (type === 'input')
      handleInputParameterChange(key as keyof WorkflowToolProviderParameter, value, index)
    else if (type === 'output')
      handleOutputParameterChange(key as keyof WorkflowToolProviderOutputParameter, value, index)
  }
  const [labels, setLabels] = useState<string[]>(payload.labels)
  const handleLabelSelect = (value: string[]) => {
    setLabels(value)
  }
  const [privacyPolicy, setPrivacyPolicy] = useState(payload.privacy_policy)
  const [showModal, setShowModal] = useState(false)

  const isNameValid = (name: string) => {
    // when the user has not input anything, no need for a warning
    if (name === '')
      return true

    return /^\w+$/.test(name)
  }

  const isOutputParameterReserved = (name: string) => {
    return ['text', 'files', 'json'].includes(name)
  }

  const typeMap: Record<string, { type: string; items?: { type: string } }> = {
    [VarType.string]: { type: 'string' },
    [VarType.number]: { type: 'number' },
    [VarType.integer]: { type: 'number' },
    [VarType.secret]: { type: 'string' },
    [VarType.boolean]: { type: 'boolean' },
    [VarType.object]: { type: 'object' },
    [VarType.file]: { type: 'file' }, // `file` is not standard json schema type, but here use to display
    [VarType.array]: { type: 'array', items: { type: 'string' } },
    [VarType.arrayString]: { type: 'array', items: { type: 'string' } },
    [VarType.arrayNumber]: { type: 'array', items: { type: 'number' } },
    [VarType.arrayObject]: { type: 'array', items: { type: 'object' } },
    [VarType.arrayBoolean]: { type: 'array', items: { type: 'boolean' } },
    [VarType.arrayFile]: { type: 'array', items: { type: 'file' } }, // `file` is not standard json schema type, but here use to display
    [VarType.any]: { type: 'string' },
    [VarType.arrayAny]: { type: 'array' },
  }

  const onConfirm = () => {
    let errorMessage = ''
    if (!label)
      errorMessage = t('common.errorMsg.fieldRequired', { field: t('tools.createTool.name') })

    if (!name)
      errorMessage = t('common.errorMsg.fieldRequired', { field: t('tools.createTool.nameForToolCall') })

    if (!isNameValid(name))
      errorMessage = t('tools.createTool.nameForToolCall') + t('tools.createTool.nameForToolCallTip')

    if (outputParameters.some(item => isOutputParameterReserved(item.name)))
      errorMessage = t('tools.createTool.toolOutput.reservedParameterDuplicateTip')

    if (errorMessage) {
      Toast.notify({
        type: 'error',
        message: errorMessage,
      })
      return
    }

    const requestParams = {
      name,
      description,
      icon: emoji,
      label,
      parameters: parameters.map(item => ({
        name: item.name,
        description: item.description,
        form: item.form,
      })),
      output_schema: {
        type: 'object',
        properties: outputParameters.reduce((acc: Record<string, any>, item) => {
          if (!item.type)
            return acc

          const schemaInfo = typeMap[item.type]
          if (schemaInfo) {
            acc[item.name] = {
              description: item.description,
              ...schemaInfo,
            }
          }
          return acc
        }, {}),
      },
      labels,
      privacy_policy: privacyPolicy,
    }
    if (!isAdd) {
      onSave?.({
        ...requestParams,
        workflow_tool_id: payload.workflow_tool_id,
      })
    }
    else {
      onCreate?.({
        ...requestParams,
        workflow_app_id: payload.workflow_app_id,
      })
    }
  }

  return (
    <>
      <Drawer
        isShow
        onHide={onHide}
        title={t('workflow.common.workflowAsTool')!}
        panelClassName='mt-2 !w-[640px]'
        maxWidthClassName='!max-w-[640px]'
        height='calc(100vh - 16px)'
        headerClassName='!border-b-divider'
        body={
          <div className='flex h-full flex-col'>
            <div className='h-0 grow space-y-4 overflow-y-auto px-6 py-3'>
              {/* name & icon */}
              <div>
                <div className='system-sm-medium py-2 text-text-primary'>{t('tools.createTool.name')} <span className='ml-1 text-red-500'>*</span></div>
                <div className='flex items-center justify-between gap-3'>
                  <AppIcon size='large' onClick={() => { setShowEmojiPicker(true) }} className='cursor-pointer' iconType='emoji' icon={emoji.content} background={emoji.background} />
                  <Input
                    className='h-10 grow'
                    placeholder={t('tools.createTool.toolNamePlaceHolder')!}
                    value={label}
                    onChange={e => setLabel(e.target.value)}
                  />
                </div>
              </div>
              {/* name for tool call */}
              <div>
                <div className='system-sm-medium flex items-center py-2 text-text-primary'>
                  {t('tools.createTool.nameForToolCall')} <span className='ml-1 text-red-500'>*</span>
                  <Tooltip
                    popupContent={
                      <div className='w-[180px]'>
                        {t('tools.createTool.nameForToolCallPlaceHolder')}
                      </div>
                    }
                  />
                </div>
                <Input
                  className='h-10'
                  placeholder={t('tools.createTool.nameForToolCallPlaceHolder')!}
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
                {!isNameValid(name) && (
                  <div className='text-xs leading-[18px] text-red-500'>{t('tools.createTool.nameForToolCallTip')}</div>
                )}
              </div>
              {/* description */}
              <div>
                <div className='system-sm-medium py-2 text-text-primary'>{t('tools.createTool.description')}</div>
                <Textarea
                  placeholder={t('tools.createTool.descriptionPlaceholder') || ''}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </div>
              {/* Tool Input  */}
              <div>
                <div className='system-sm-medium py-2 text-text-primary'>{t('tools.createTool.toolInput.title')}</div>
                <div className='w-full overflow-x-auto rounded-lg border border-divider-regular'>
                  <table className='w-full text-xs font-normal leading-[18px] text-text-secondary'>
                    <thead className='uppercase text-text-tertiary'>
                      <tr className='border-b border-divider-regular'>
                        <th className="w-[156px] p-2 pl-3 font-medium">{t('tools.createTool.toolInput.name')}</th>
                        <th className="w-[102px] p-2 pl-3 font-medium">{t('tools.createTool.toolInput.method')}</th>
                        <th className="p-2 pl-3 font-medium">{t('tools.createTool.toolInput.description')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parameters.map((item, index) => (
                        <tr key={index} className='border-b border-divider-regular last:border-0'>
                          <td className="max-w-[156px] p-2 pl-3">
                            <div className='text-[13px] leading-[18px]'>
                              <div title={item.name} className='flex'>
                                <span className='truncate font-medium text-text-primary'>{item.name}</span>
                                <span className='shrink-0 pl-1 text-xs leading-[18px] text-[#ec4a0a]'>{item.required ? t('tools.createTool.toolInput.required') : ''}</span>
                              </div>
                              <div className='text-text-tertiary'>{item.type}</div>
                            </div>
                          </td>
                          <td>
                            {item.name === '__image' && (
                              <div className={cn(
                                'flex h-9 min-h-[56px] cursor-default items-center gap-1 bg-transparent px-3 py-2',
                              )}>
                                <div className={cn('grow truncate text-[13px] leading-[18px] text-text-secondary')}>
                                  {t('tools.createTool.toolInput.methodParameter')}
                                </div>
                              </div>
                            )}
                            {item.name !== '__image' && (
                              <MethodSelector value={item.form} onChange={value => handleParameterChange('input', 'form', value, index)} />
                            )}
                          </td>
                          <td className="w-[236px] p-2 pl-3 text-text-tertiary">
                            <input
                              type='text'
                              className='w-full appearance-none bg-transparent text-[13px] font-normal leading-[18px] text-text-secondary caret-primary-600 outline-none placeholder:text-text-quaternary'
                              placeholder={t('tools.createTool.toolInput.descriptionPlaceholder')!}
                              value={item.description}
                              onChange={e => handleParameterChange('input', 'description', e.target.value, index)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {/* Tool Output  */}
              <div>
                <div className='system-sm-medium py-2 text-text-primary'>{t('tools.createTool.toolOutput.title')}</div>
                <div className='w-full overflow-x-auto rounded-lg border border-divider-regular'>
                  <table className='w-full text-xs font-normal leading-[18px] text-text-secondary'>
                    <thead className='uppercase text-text-tertiary'>
                      <tr className='border-b border-divider-regular'>
                        <th className="w-[156px] p-2 pl-3 font-medium">{t('tools.createTool.name')}</th>
                        <th className="p-2 pl-3 font-medium">{t('tools.createTool.toolOutput.description')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...reservedOutputParameters, ...outputParameters].map((item, index) => (
                        <tr key={index} className='border-b border-divider-regular last:border-0'>
                          <td className="max-w-[156px] p-2 pl-3">
                            <div className='text-[13px] leading-[18px]'>
                              <div title={item.name} className='flex'>
                                <span className='truncate font-medium text-text-primary'>{item.name}</span>
                                <span className='shrink-0 pl-1 text-xs leading-[18px] text-[#ec4a0a]'>{item.reserved ? t('tools.createTool.toolOutput.reserved') : ''}</span>
                              </div>
                              <div className='text-text-tertiary'>{item.type}</div>
                            </div>
                          </td>
                          <td className="w-[236px] p-2 pl-3 text-text-tertiary">
                            <input
                              disabled={item.reserved}
                              type='text'
                              className='w-full appearance-none bg-transparent text-[13px] font-normal leading-[18px] text-text-secondary caret-primary-600 outline-none placeholder:text-text-quaternary'
                              placeholder={t('tools.createTool.toolOutput.descriptionPlaceholder')!}
                              value={item.description}
                              onChange={item.reserved
                                ? undefined
                                : e => handleParameterChange('output', 'description', e.target.value, index - reservedOutputParameters.length)
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {/* Tags */}
              <div>
                <div className='system-sm-medium py-2 text-text-primary'>{t('tools.createTool.toolInput.label')}</div>
                <LabelSelector value={labels} onChange={handleLabelSelect} />
              </div>
              {/* Privacy Policy */}
              <div>
                <div className='system-sm-medium py-2 text-text-primary'>{t('tools.createTool.privacyPolicy')}</div>
                <Input
                  className='h-10'
                  value={privacyPolicy}
                  onChange={e => setPrivacyPolicy(e.target.value)}
                  placeholder={t('tools.createTool.privacyPolicyPlaceholder') || ''} />
              </div>
            </div>
            <div className={cn((!isAdd && onRemove) ? 'justify-between' : 'justify-end', 'mt-2 flex shrink-0 rounded-b-[10px] border-t border-divider-regular bg-background-section-burn px-6 py-4')} >
              {!isAdd && onRemove && (
                <Button variant='warning' onClick={onRemove}>{t('common.operation.delete')}</Button>
              )}
              <div className='flex space-x-2 '>
                <Button onClick={onHide}>{t('common.operation.cancel')}</Button>
                <Button variant='primary' onClick={() => {
                  if (isAdd)
                    onConfirm()
                  else
                    setShowModal(true)
                }}>{t('common.operation.save')}</Button>
              </div>
            </div>
          </div>
        }
        isShowMask={true}
        clickOutsideNotOpen={true}
      />
      {showEmojiPicker && <EmojiPicker
        onSelect={(icon, icon_background) => {
          setEmoji({ content: icon, background: icon_background })
          setShowEmojiPicker(false)
        }}
        onClose={() => {
          setShowEmojiPicker(false)
        }}
      />}
      {showModal && (
        <ConfirmModal
          show={showModal}
          onClose={() => setShowModal(false)}
          onConfirm={onConfirm}
        />
      )}
    </>

  )
}
export default React.memo(WorkflowToolAsModal)
