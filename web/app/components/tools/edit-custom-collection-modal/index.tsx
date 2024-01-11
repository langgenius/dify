'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LinkExternal02 } from '../../base/icons/src/vender/line/general'
import GetSchema from './get-schema'
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

  const [schema, setSchema] = useState('')

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
        headerClassName='!border-b-black/5'
        body={
          <div className='flex flex-col h-full'>
            <div className='grow h-0 overflow-y-auto px-6 py-3 space-y-4'>
              <div>
                <div className={fieldNameClassNames}>{t('tools.createTool.name')}</div>
                <div className='flex items-center justify-between gap-3'>
                  <AppIcon size='large' onClick={() => { setShowEmojiPicker(true) }} className='cursor-pointer' icon={emoji.icon} background={emoji.icon_background} />
                  <input className='h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg grow' placeholder={t('tools.createTool.toolNamePlaceHolder')!} />
                </div>
              </div>

              <div className='select-none'>
                <div className='flex justify-between items-center'>
                  <div className='flex items-center'>
                    <div className={fieldNameClassNames}>{t('tools.createTool.schema')}</div>
                    <div className='mx-2 w-px h-3 bg-black/5'></div>
                    <a
                      href="https://swagger.io/specification/"
                      target='_blank'
                      className='flex items-center h-[18px] space-x-1  text-[#155EEF]'
                    >
                      <div className='text-xs font-normal'>{t('tools.createTool.viewSchemaSpec')}</div>
                      <LinkExternal02 className='w-3 h-3' />
                    </a>
                  </div>
                  <GetSchema onChange={setSchema} />

                </div>
                <textarea
                  value={schema}
                  onChange={e => setSchema(e.target.value)}
                  className='w-full h-[240px] px-3 py-2 leading-4 text-xs font-normal text-gray-900 bg-gray-100 rounded-lg overflow-y-auto'
                  placeholder={t('tools.createTool.schemaPlaceHolder')!}
                >

                </textarea>
              </div>

              <div>
                <div className={fieldNameClassNames}>{t('tools.createTool.availableTools.title')}</div>
                <div className='rounded-lg border border-gray-200'>
                  <table className='w-full  leading-[18px] text-xs text-gray-700 font-normal'>
                    <thead className='text-gray-500 uppercase'>
                      <tr className='border-b border-gray-200'>
                        <th className="p-2 pl-3 font-medium">{t('tools.createTool.availableTools.name')}</th>
                        <th className="p-2 pl-3 font-medium w-[236px]">{t('tools.createTool.availableTools.description')}</th>
                        <th className="p-2 pl-3 font-medium">{t('tools.createTool.availableTools.method')}</th>
                        <th className="p-2 pl-3 font-medium">{t('tools.createTool.availableTools.path')}</th>
                        <th className="p-2 pl-3 font-medium w-[54px]">{t('tools.createTool.availableTools.action')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className='border-b last:border-0 border-gray-200'>
                        <td className="p-2 pl-3">xx</td>
                        <td className="p-2 pl-3 text-gray-500 w-[236px]">Retrieves and displays a list of all pets registered in the system.</td>
                        <td className="p-2 pl-3">GET</td>
                        <td className="p-2 pl-3">/pets</td>
                        <td className="p-2 pl-3 w-[54px]">
                          <Button className='!h-6 !px-2 text-xs font-medium text-gray-700'>{t('tools.createTool.availableTools.test')}</Button>
                        </td>
                      </tr>
                      <tr className='border-b last:border-0 border-gray-200'>
                        <td className="p-2 pl-3">xx</td>
                        <td className="p-2 pl-3 text-gray-500 w-[236px]">Retrieves and displays a list of all pets registered in the system.</td>
                        <td className="p-2 pl-3">GET</td>
                        <td className="p-2 pl-3">/pets</td>
                        <td className="p-2 pl-3 w-[54px]">
                          <Button className='!h-6 !px-2 text-xs font-medium text-gray-700'>{t('tools.createTool.availableTools.test')}</Button>
                        </td>
                      </tr>
                      <tr className='border-b last:border-0 border-gray-200'>
                        <td className="p-2 pl-3">xx</td>
                        <td className="p-2 pl-3 text-gray-500 w-[236px]">Retrieves and displays a list of all pets registered in the system.</td>
                        <td className="p-2 pl-3">GET</td>
                        <td className="p-2 pl-3">/pets</td>
                        <td className="p-2 pl-3 w-[54px]">
                          <Button className='!h-6 !px-2 text-xs font-medium text-gray-700'>{t('tools.createTool.availableTools.test')}</Button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
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
