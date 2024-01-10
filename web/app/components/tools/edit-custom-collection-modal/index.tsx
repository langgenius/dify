'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Drawer from '@/app/components/base/drawer-plus'
import Button from '@/app/components/base/button'
import EmojiPicker from '@/app/components/base/emoji-picker'
import AppIcon from '@/app/components/base/app-icon'

const fieldNameClassNames = 'py-2 leading-5 text-sm font-medium text-gray-900'
type Props = {
  payload: any
  onHide: () => void
}
// Add and Edit
const EditCustomCollectionModal: FC<Props> = ({
  payload,
  onHide,
}) => {
  const { t } = useTranslation()
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [emoji, setEmoji] = useState({ icon: '🕵️', icon_background: '#FEF7C3' })

  const isAdd = !!payload

  return (
    <>
      <Drawer
        isShow
        onHide={onHide}
        title={t('tools.createTool.title') as string}
        panelClassName='mt-2 !w-[640px]'
        maxWidthClassName='!max-w-[640px]'
        height='calc(100vh - 16px)'
        contentClassName='!bg-gray-100'
        headerClassName='!border-b-black/5'
        body={
          <div className='flex flex-col h-full space-y-4'>
            <div className='grow h-0 overflow-y-auto px-6 py-3'>
              <div>
                <div className={fieldNameClassNames}>{t('tools.createTool.name')}</div>
                <div className='flex items-center justify-between gap-3'>
                  <AppIcon size='large' onClick={() => { setShowEmojiPicker(true) }} className='cursor-pointer' icon={emoji.icon} background={emoji.icon_background} />
                  <input className='h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg grow' placeholder={t('app.appNamePlaceholder') || ''} />
                </div>
              </div>

              <div>
                <div className={fieldNameClassNames}>{t('tools.createTool.schema')}</div>
                <textarea>

                </textarea>
              </div>

              <div>
                <div className={fieldNameClassNames}>{t('tools.createTool.availableTools.name')}</div>
                <table>
                  <thead>
                    <tr>
                      <th className="p-2 border border-slate-300">code</th>
                      <th className="p-2 border border-slate-300">status</th>
                      <th className="p-2 border border-slate-300">message</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="p-2 border border-slate-300">code</td>
                      <td className="p-2 border border-slate-300">code</td>
                      <td className="p-2 border border-slate-300">code</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div>
                <div className={fieldNameClassNames}>{t('tools.createTool.authMethod')}</div>
                <input className='h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg grow' placeholder={t('app.appNamePlaceholder') || ''} />
              </div>

              <div>
                <div className={fieldNameClassNames}>{t('tools.createTool.privacyPolicy')}</div>
                <input className='h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg grow' placeholder={t('app.appNamePlaceholder') || ''} />
              </div>

            </div>
            <div className='shrink-0 flex justify-end space-x-2 py-4 pr-6 rounded-b-[10px] bg-gray-50 border-t border-black/5'>
              <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700' onClick={onHide}>{t('common.operation.cancel')}</Button>
              <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium' type='primary' onClick={onHide}>{t('common.operation.save')}</Button>
            </div>
          </div>
        }
        isShowMask={true}
        clickOutsideNotOpen={true}
      />
      {showEmojiPicker && <EmojiPicker
        onSelect={(icon, icon_background) => {
          setEmoji({ icon, icon_background })
          setShowEmojiPicker(false)
        }}
        onClose={() => {
          setEmoji({ icon: '🤖', icon_background: '#FFEAD5' })
          setShowEmojiPicker(false)
        }}
      />}
    </>

  )
}
export default React.memo(EditCustomCollectionModal)
