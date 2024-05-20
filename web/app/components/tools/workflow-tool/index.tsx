'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
// import produce from 'immer'
import type { Emoji, WorkflowToolProvider, WorkflowToolProviderParameter } from '../types'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'
import Drawer from '@/app/components/base/drawer-plus'
import Button from '@/app/components/base/button'
import EmojiPicker from '@/app/components/base/emoji-picker'
import AppIcon from '@/app/components/base/app-icon'

type Props = {
  isAdd?: boolean
  payload: any
  onHide: () => void
  onRemove?: () => void
  onSave: (payload: WorkflowToolProvider) => void
}
// Add and Edit
const WorkflowToolAsModal: FC<Props> = ({
  isAdd,
  payload,
  onHide,
  onRemove,
  onSave,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)

  const [showEmojiPicker, setShowEmojiPicker] = useState<Boolean>(false)
  const [emoji, setEmoji] = useState<Emoji>(payload.icon)
  const [name, setName] = useState(payload.name)
  const [description, setDescription] = useState(isAdd ? payload.description : payload.description[language])
  const [parameters, setParameters] = useState<WorkflowToolProviderParameter[]>(payload.parameters)
  const [labels, setLabels] = useState<string[]>(payload.labels)
  const [privacyPolicy, setPrivacyPolicy] = useState(payload.privacy_policy)

  const onConfirm = () => {
    onSave({
      id: payload.id,
      name,
      description,
      icon: emoji,
      parameters,
      labels,
      privacy_policy: privacyPolicy,
    })
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
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </div>
              </div>
              {/* description */}
              <div>
                <div className='py-2 leading-5 text-sm font-medium text-gray-900'>{t('tools.createTool.description')}</div>
                <textarea
                  className='w-full h-10 px-3 py-2 text-sm font-normal bg-gray-100 rounded-lg border border-transparent outline-none appearance-none caret-primary-600 placeholder:text-gray-400 hover:bg-gray-50 hover:border hover:border-gray-300 focus:bg-gray-50 focus:border focus:border-gray-300 focus:shadow-xs h-[80px] resize-none'
                  placeholder={t('tools.createTool.descriptionPlacehoder') || ''}
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
                        <th className="p-2 pl-3 font-medium">{t('tools.createTool.toolInput.name')}</th>
                        <th className="p-2 pl-3 font-medium">{t('tools.createTool.toolInput.method')}</th>
                        <th className="p-2 pl-3 font-medium w-[236px]">{t('tools.createTool.toolInput.description')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parameters.map((item, index) => (
                        <tr key={index} className='border-b last:border-0 border-gray-200'>
                          <td className="p-2 pl-3">{item.name}</td>
                          <td className="p-2 pl-3">{item.form}</td>
                          <td className="p-2 pl-3 text-gray-500 w-[236px]">{item.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {/* Labels */}
              <div>
                <div className='py-2 leading-5 text-sm font-medium text-gray-900'>{t('tools.createTool.toolInput.label')}</div>
                <input
                  value={labels.join(',')}
                  onChange={() => {}}
                  className='grow w-full h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg border border-transparent outline-none appearance-none caret-primary-600 placeholder:text-gray-400 hover:bg-gray-50 hover:border hover:border-gray-300 focus:bg-gray-50 focus:border focus:border-gray-300 focus:shadow-xs' placeholder={t('tools.createTool.toolInput.labelPlaceholder') || ''} />
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
            <div className={cn(!isAdd ? 'justify-between' : 'justify-end', 'mt-2 shrink-0 flex py-4 px-6 rounded-b-[10px] bg-gray-50 border-t border-black/5')} >
              {!isAdd && (
                <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700' onClick={onRemove}>{t('common.operation.remove')}</Button>
              )}
              <div className='flex space-x-2 '>
                <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700' onClick={onHide}>{t('common.operation.cancel')}</Button>
                <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium' type='primary' onClick={onConfirm}>{t('common.operation.save')}</Button>
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
    </>

  )
}
export default React.memo(WorkflowToolAsModal)
