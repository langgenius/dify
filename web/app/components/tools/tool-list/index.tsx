'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { LOC } from '../types'
import type { Collection, Tool } from '../types'
import Loading from '../../base/loading'
import { ArrowNarrowRight } from '../../base/icons/src/vender/line/arrows'
import Header from './header'
import Item from './item'
import AppIcon from '@/app/components/base/app-icon'
import ConfigCredential from '@/app/components/tools/setting/build-in/config-credentials'
import { updateBuiltInToolCredential } from '@/service/tools'
type Props = {
  collection: Collection | null
  list: Tool[]
  // onToolListChange: () => void // custom tools change
  loc: LOC
  addedToolNames?: string[]
  onAddTool?: (payload: Tool) => void
}

const ToolList: FC<Props> = ({
  collection,
  list,
  loc,
  addedToolNames,
  onAddTool,
}) => {
  const { t } = useTranslation()
  const isInToolsPage = loc === LOC.tools

  const [showSettingAuth, setShowSettingAuth] = useState(false)
  if (!collection)
    return <Loading type='app' />

  const icon = <>{typeof collection.icon === 'string'
    ? (
      <div
        className='p-2 bg-cover bg-center border border-gray-100 rounded-lg'
      >
        <div className='w-6 h-6 bg-center bg-contain'
          style={{
            backgroundImage: `url(${collection.icon}?_token=${localStorage.getItem('console_token')})`,
          }}
        ></div>
      </div>
    )
    : (
      <AppIcon
        size='large'
        innerIcon={(collection.icon as any).content}
        background={(collection.icon as any).content}
      />
    )}
  </>

  return (
    <div className='flex flex-col h-full pb-4'>
      <Header
        icon={icon}
        collection={collection}
        loc={loc}
        onShowAuth={() => isInToolsPage && setShowSettingAuth(true)}
      />
      <div className={cn(isInToolsPage ? 'px-6 pt-4' : 'px-4 pt-3')}>
        <div className='flex items-center h-[4.5] space-x-2  text-xs font-medium text-gray-500'>
          <div className=''>{t('tools.includeToolNum', {
            num: list.length,
          })}</div>
          {!collection.is_team_authorization && isInToolsPage && (
            <>
              <div>·</div>
              <div
                className='flex items-center text-[#155EEF] cursor-pointer'
                onClick={() => setShowSettingAuth(true)}
              >
                <div>{t('tools.auth.setup')}</div>
                <ArrowNarrowRight className='ml-0.5 w-3 h-3' />
              </div>
            </>
          )}
        </div>
      </div>
      <div className={cn(isInToolsPage ? 'px-6 pt-4' : 'px-4 pt-3', 'grow h-0 overflow-y-auto')}>
        {/* list */}
        <div className={cn(isInToolsPage ? 'grid-cols-3 gap-4' : 'grid-cols-1 gap-2', 'mt-2 grid')}>
          {list.map(item => (
            <Item
              key={item.name}
              icon={icon}
              payload={item}
              collection={collection}
              isInToolsPage={isInToolsPage}
              added={addedToolNames?.includes(item.name)}
              onAdd={onAddTool}
            />
          ))}
        </div>
      </div>
      {showSettingAuth && (
        <ConfigCredential
          collectionName={collection.name}
          credentialValue={collection.team_credentials}
          onCancel={() => setShowSettingAuth(false)}
          onSaved={async (value) => {
            await updateBuiltInToolCredential(collection.name, value)
            setShowSettingAuth(false)
          }}
        />
      )}
    </div>
  )
}
export default React.memo(ToolList)
