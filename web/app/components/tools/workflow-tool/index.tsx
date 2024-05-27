'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import produce from 'immer'
import type { Emoji, WorkflowToolProviderParameter, WorkflowToolProviderRequest } from '../types'
import Drawer from '@/app/components/base/drawer-plus'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import EmojiPicker from '@/app/components/base/emoji-picker'
import AppIcon from '@/app/components/base/app-icon'
import MethodSelector from '@/app/components/tools/workflow-tool/method-selector'
import LabelSelector from '@/app/components/tools/labels/selector'
import ConfirmModal from '@/app/components/tools/workflow-tool/confirm-modal'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
import Tooltip from '@/app/components/base/tooltip'

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

  const [showEmojiPicker, setShowEmojiPicker] = useState<Boolean>(false)
  const [emoji, setEmoji] = useState<Emoji>(payload.icon)
  const [label, setLabel] = useState<string>(payload.label)
  const [name, setName] = useState(payload.name)
  const [description, setDescription] = useState(payload.description)
  const [parameters, setParameters] = useState<WorkflowToolProviderParameter[]>(payload.parameters)
  const handleParameterChange = (key: string, value: string, index: number) => {
    const newData = produce(parameters, (draft: WorkflowToolProviderParameter[]) => {
      if (key === 'description')
        draft[index].description = value
      else
        draft[index].form = value
    })
    setParameters(newData)
  }
  const [labels, setLabels] = useState<string[]>(payload.labels)
  const handleLabelSelect = (value: string[]) => {
    setLabels(value)
  }
  const [privacyPolicy, setPrivacyPolicy] = useState(payload.privacy_policy)
  const [showModal, setShowModal] = useState(false)

  const isNameValid = (name: string) => {
    return /^[a-zA-Z0-9_]+$/.test(name)
  }

  const onConfirm = () => {
    if (!label) {
      return Toast.notify({
        type: 'error',
        message: 'Please enter the tool name',
      })
    }
    if (!name) {
      return Toast.notify({
        type: 'error',
        message: 'Please enter the name for tool call',
      })
    }
    else if (!isNameValid(name)) {
      return Toast.notify({
        type: 'error',
        message: 'Name for tool call can only contain numbers, letters, and underscores',
      })
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
        headerClassName='!border-b-black/5'
        body={
          <div className='flex flex-col h-full'>
            <div className='grow h-0 overflow-y-auto px-6 py-3 space-y-4'>
              {/* name & icon */}
              <div>
                <div className='py-2 leading-5 text-sm font-medium text-gray-900'>{t('tools.createTool.name')}</div>
                <div className='flex items-center justify-between gap-3'>
                  <AppIcon size='large' onClick={() => { setShowEmojiPicker(true) }} className='cursor-pointer' icon={emoji.content} background={emoji.background} />
                  <input
                    type='text'
                    className='grow h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg border border-transparent outline-none appearance-none caret-primary-600 placeholder:text-gray-400 hover:bg-gray-50 hover:border hover:border-gray-300 focus:bg-gray-50 focus:border focus:border-gray-300 focus:shadow-xs'
                    placeholder={t('tools.createTool.toolNamePlaceHolder')!}
                    value={label}
                    onChange={e => setLabel(e.target.value)}
                  />
                </div>
              </div>
              {/* name for tool call */}
              <div>
                <div className='flex items-center py-2 leading-5 text-sm font-medium text-gray-900'>
                  {t('tools.createTool.nameForToolCall')}
                  <Tooltip
                    htmlContent={
                      <div className='w-[180px]'>
                        {t('tools.createTool.nameForToolCallPlaceHolder')}
                      </div>
                    }
                    selector='workflow-tool-modal-tooltip'
                  >
                    <HelpCircle className='ml-2 w-[14px] h-[14px] text-gray-400' />
                  </Tooltip>
                </div>
                <input
                  type='text'
                  className='w-full h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg border border-transparent outline-none appearance-none caret-primary-600 placeholder:text-gray-400 hover:bg-gray-50 hover:border hover:border-gray-300 focus:bg-gray-50 focus:border focus:border-gray-300 focus:shadow-xs'
                  placeholder={t('tools.createTool.nameForToolCallPlaceHolder')!}
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
                {!isNameValid(name) && (
                  <div className='text-xs leading-[18px] text-[#DC6803]'>{t('tools.createTool.nameForToolCallTip')}</div>
                )}
              </div>
              {/* description */}
              <div>
                <div className='py-2 leading-5 text-sm font-medium text-gray-900'>{t('tools.createTool.description')}</div>
                <textarea
                  className='w-full h-10 px-3 py-2 text-sm font-normal bg-gray-100 rounded-lg border border-transparent outline-none appearance-none caret-primary-600 placeholder:text-gray-400 hover:bg-gray-50 hover:border hover:border-gray-300 focus:bg-gray-50 focus:border focus:border-gray-300 focus:shadow-xs h-[80px] resize-none'
                  placeholder={t('tools.createTool.descriptionPlaceholder') || ''}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </div>
              {/* Tool Input  */}
              <div>
                <div className='py-2 leading-5 text-sm font-medium text-gray-900'>{t('tools.createTool.toolInput.title')}</div>
                <div className='rounded-lg border border-gray-200 w-full overflow-x-auto'>
                  <table className='w-full leading-[18px] text-xs text-gray-700 font-normal'>
                    <thead className='text-gray-500 uppercase'>
                      <tr className='border-b border-gray-200'>
                        <th className="p-2 pl-3 font-medium w-[156px]">{t('tools.createTool.toolInput.name')}</th>
                        <th className="p-2 pl-3 font-medium w-[102px]">{t('tools.createTool.toolInput.method')}</th>
                        <th className="p-2 pl-3 font-medium">{t('tools.createTool.toolInput.description')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parameters.map((item, index) => (
                        <tr key={index} className='border-b last:border-0 border-gray-200'>
                          <td className="p-2 pl-3 max-w-[156px]">
                            <div className='text-[13px] leading-[18px]'>
                              <div title={item.name} className='flex'>
                                <span className='font-medium text-gray-900 truncate'>{item.name}</span>
                                <span className='shrink-0 pl-1 text-[#ec4a0a] text-xs leading-[18px]'>{item.required ? t('tools.createTool.toolInput.required') : ''}</span>
                              </div>
                              <div className='text-gray-500'>{item.type}</div>
                            </div>
                          </td>
                          <td>
                            {item.name === '__image' && (
                              <div className={cn(
                                'flex items-center gap-1 min-h-[56px] px-3 py-2 h-9 bg-white cursor-default',
                              )}>
                                <div className={cn('grow text-[13px] leading-[18px] text-gray-700 truncate')}>
                                  {t('tools.createTool.toolInput.methodParameter')}
                                </div>
                              </div>
                            )}
                            {item.name !== '__image' && (
                              <MethodSelector value={item.form} onChange={value => handleParameterChange('form', value, index)}/>
                            )}
                          </td>
                          <td className="p-2 pl-3 text-gray-500 w-[236px]">
                            <input
                              type='text'
                              className='grow text-gray-700 text-[13px] leading-[18px] font-normal bg-white outline-none appearance-none caret-primary-600 placeholder:text-gray-300'
                              placeholder={t('tools.createTool.toolInput.descriptionPlaceholder')!}
                              value={item.description}
                              onChange={e => handleParameterChange('description', e.target.value, index)}
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
                <div className='py-2 leading-5 text-sm font-medium text-gray-900'>{t('tools.createTool.toolInput.label')}</div>
                <LabelSelector value={labels} onChange={handleLabelSelect} />
              </div>
              {/* Privacy Policy */}
              <div>
                <div className='py-2 leading-5 text-sm font-medium text-gray-900'>{t('tools.createTool.privacyPolicy')}</div>
                <input
                  value={privacyPolicy}
                  onChange={e => setPrivacyPolicy(e.target.value)}
                  className='grow w-full h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg border border-transparent outline-none appearance-none caret-primary-600 placeholder:text-gray-400 hover:bg-gray-50 hover:border hover:border-gray-300 focus:bg-gray-50 focus:border focus:border-gray-300 focus:shadow-xs' placeholder={t('tools.createTool.privacyPolicyPlaceholder') || ''} />
              </div>
            </div>
            <div className={cn((!isAdd && onRemove) ? 'justify-between' : 'justify-end', 'mt-2 shrink-0 flex py-4 px-6 rounded-b-[10px] bg-gray-50 border-t border-black/5')} >
              {!isAdd && onRemove && (
                <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700' onClick={onRemove}>{t('common.operation.remove')}</Button>
              )}
              <div className='flex space-x-2 '>
                <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700' onClick={onHide}>{t('common.operation.cancel')}</Button>
                <Button disabled={!label || !name || !isNameValid(name)} className='flex items-center h-8 !px-3 !text-[13px] font-medium' type='primary' onClick={() => {
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
