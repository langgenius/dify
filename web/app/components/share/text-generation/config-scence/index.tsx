import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  PlayIcon,
} from '@heroicons/react/24/solid'
import Select from '@/app/components/base/select'
import type { SiteInfo } from '@/models/share'
import type { PromptConfig } from '@/models/debug'
import Button from '@/app/components/base/button'
import { DEFAULT_VALUE_MAX_LEN } from '@/config'

export type IConfigSenceProps = {
  siteInfo: SiteInfo
  promptConfig: PromptConfig
  inputs: Record<string, any>
  onInputsChange: (inputs: Record<string, any>) => void
  query: string
  onQueryChange: (query: string) => void
  onSend: () => void
}
const ConfigSence: FC<IConfigSenceProps> = ({
  promptConfig,
  inputs,
  onInputsChange,
  query,
  onQueryChange,
  onSend,
}) => {
  const { t } = useTranslation()

  return (
    <div className="">
      <section>
        {/* input form */}
        <form>
          {promptConfig.prompt_variables.map(item => (
            <div className='w-full mt-4' key={item.key}>
              <label className='text-gray-900 text-sm font-medium'>{item.name}</label>
              <div className='mt-2'>
                {item.type === 'select'
                  ? (
                    <Select
                      className='w-full'
                      defaultValue={inputs[item.key]}
                      onSelect={(i) => { onInputsChange({ ...inputs, [item.key]: i.value }) }}
                      items={(item.options || []).map(i => ({ name: i, value: i }))}
                      allowSearch={false}
                      bgClassName='bg-gray-50'
                    />
                  )
                  : (
                    <input
                      type="text"
                      className="block w-full p-2 text-gray-900 border border-gray-300 rounded-lg bg-gray-50 sm:text-xs focus:ring-blue-500 focus:border-blue-500 "
                      placeholder={`${item.name}${!item.required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
                      value={inputs[item.key]}
                      onChange={(e) => { onInputsChange({ ...inputs, [item.key]: e.target.value }) }}
                      maxLength={item.max_length || DEFAULT_VALUE_MAX_LEN}
                    />
                  )}
              </div>
            </div>
          ))}
          {promptConfig.prompt_variables.length > 0 && (
            <div className='mt-6 h-[1px] bg-gray-100'></div>
          )}
          <div className='w-full mt-5'>
            <label className='text-gray-900 text-sm font-medium'>{t('share.generation.queryTitle')}</label>
            <div className="mt-2 overflow-hidden rounded-lg bg-gray-50 ">
              <div className="px-4 py-2 bg-gray-50 rounded-t-lg">
                <textarea
                  value={query}
                  onChange={(e) => { onQueryChange(e.target.value) }}
                  rows={4}
                  className="w-full px-0 text-sm text-gray-900 border-0 bg-gray-50 focus:outline-none placeholder:bg-gray-50"
                  placeholder={t('share.generation.queryPlaceholder') as string}
                  required
                >
                </textarea>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex pl-0 space-x-1 sm:pl-2">
                  <span className="bg-gray-100 text-gray-500 text-xs font-medium mr-2 px-2.5 py-0.5 rounded cursor-pointer">{query?.length}</span>
                </div>
                <Button
                  type="primary"
                  className='w-[80px] !h-8 !p-0'
                  onClick={onSend}
                  disabled={!query || query === ''}
                >
                  <PlayIcon className="shrink-0 w-4 h-4 mr-1" aria-hidden="true" />
                  <span className='uppercase text-[13px]'>{t('share.generation.run')}</span>
                </Button>
              </div>
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}
export default React.memo(ConfigSence)
