'use client'
import useSWR from 'swr'
import type { FC } from 'react'
import { useContext } from 'use-context-selector'
import React, { Fragment } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Listbox, Transition } from '@headlessui/react'
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/20/solid'
import classNames from '@/utils/classnames'
import RadioGroup from '@/app/components/app/configuration/config-vision/radio-group'
import type { Item } from '@/app/components/base/select'
import ConfigContext from '@/context/debug-configuration'
import { fetchAppVoices } from '@/service/apps'
import Tooltip from '@/app/components/base/tooltip'
import { languages } from '@/i18n/language'
import { TtsAutoPlay } from '@/types/app'
const VoiceParamConfig: FC = () => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const matched = pathname.match(/\/app\/([^/]+)/)
  const appId = (matched?.length && matched[1]) ? matched[1] : ''

  const {
    textToSpeechConfig,
    setTextToSpeechConfig,
  } = useContext(ConfigContext)

  let languageItem = languages.find(item => item.value === textToSpeechConfig.language)
  const localLanguagePlaceholder = languageItem?.name || t('common.placeholder.select')
  if (languages && !languageItem && languages.length > 0)
    languageItem = languages[0]
  const language = languageItem?.value
  const voiceItems = useSWR({ appId, language }, fetchAppVoices).data
  let voiceItem = voiceItems?.find(item => item.value === textToSpeechConfig.voice)
  if (voiceItems && !voiceItem && voiceItems.length > 0)
    voiceItem = voiceItems[0]

  const localVoicePlaceholder = voiceItem?.name || t('common.placeholder.select')

  return (
    <div>
      <div>
        <div className='leading-6 text-base font-semibold text-gray-800'>{t('appDebug.voice.voiceSettings.title')}</div>
        <div className='pt-3 space-y-6'>
          <div>
            <div className='mb-2 flex items-center  space-x-1'>
              <div
                className='leading-[18px] text-[13px] font-semibold text-gray-800'>{t('appDebug.voice.voiceSettings.language')}</div>
              <Tooltip
                popupContent={
                  <div className='w-[180px]'>
                    {t('appDebug.voice.voiceSettings.resolutionTooltip').split('\n').map(item => (
                      <div key={item}>{item}</div>
                    ))}
                  </div>
                }
              />
            </div>
            <Listbox
              value={languageItem}
              onChange={(value: Item) => {
                setTextToSpeechConfig({
                  ...textToSpeechConfig,
                  language: String(value.value),
                })
              }}
            >
              <div className={'relative h-9'}>
                <Listbox.Button
                  className={'w-full h-full rounded-lg border-0 bg-gray-100 py-1.5 pl-3 pr-10 sm:text-sm sm:leading-6 focus-visible:outline-none focus-visible:bg-gray-200 group-hover:bg-gray-200 cursor-pointer'}>
                  <span className={classNames('block truncate text-left', !languageItem?.name && 'text-gray-400')}>
                    {languageItem?.name ? t(`common.voice.language.${languageItem?.value.replace('-', '')}`) : localLanguagePlaceholder}
                  </span>
                  <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                    <ChevronDownIcon
                      className="h-5 w-5 text-gray-400"
                      aria-hidden="true"
                    />
                  </span>
                </Listbox.Button>
                <Transition
                  as={Fragment}
                  leave="transition ease-in duration-100"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0"
                >

                  <Listbox.Options
                    className="absolute z-10 mt-1 px-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg border-gray-200 border-[0.5px] focus:outline-none sm:text-sm">
                    {languages.map((item: Item) => (
                      <Listbox.Option
                        key={item.value}
                        className={({ active }) =>
                          `relative cursor-pointer select-none py-2 pl-3 pr-9 rounded-lg hover:bg-gray-100 text-gray-700 ${active ? 'bg-gray-100' : ''
                          }`
                        }
                        value={item}
                        disabled={false}
                      >
                        {({ /* active, */ selected }) => (
                          <>
                            <span
                              className={classNames('block', selected && 'font-normal')}>{t(`common.voice.language.${(item.value).toString().replace('-', '')}`)}</span>
                            {(selected || item.value === textToSpeechConfig.language) && (
                              <span
                                className={classNames(
                                  'absolute inset-y-0 right-0 flex items-center pr-4 text-gray-700',
                                )}
                              >
                                <CheckIcon className="h-5 w-5" aria-hidden="true" />
                              </span>
                            )}
                          </>
                        )}
                      </Listbox.Option>
                    ))}
                  </Listbox.Options>
                </Transition>
              </div>
            </Listbox>
          </div>
          <div>
            <div
              className='mb-2 leading-[18px] text-[13px] font-semibold text-gray-800'>{t('appDebug.voice.voiceSettings.voice')}</div>
            <Listbox
              value={voiceItem ?? {}}
              disabled={!languageItem}
              onChange={(value: Item) => {
                if (!value.value)
                  return
                setTextToSpeechConfig({
                  ...textToSpeechConfig,
                  voice: String(value.value),
                })
              }}
            >
              <div className={'relative h-9'}>
                <Listbox.Button
                  className={'w-full h-full rounded-lg border-0 bg-gray-100 py-1.5 pl-3 pr-10 sm:text-sm sm:leading-6 focus-visible:outline-none focus-visible:bg-gray-200 group-hover:bg-gray-200 cursor-pointer'}>
                  <span
                    className={classNames('block truncate text-left', !voiceItem?.name && 'text-gray-400')}>{voiceItem?.name ?? localVoicePlaceholder}</span>
                  <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                    <ChevronDownIcon
                      className="h-5 w-5 text-gray-400"
                      aria-hidden="true"
                    />
                  </span>
                </Listbox.Button>
                <Transition
                  as={Fragment}
                  leave="transition ease-in duration-100"
                  leaveFrom="opacity-100"
                  leaveTo="opacity-0"
                >

                  <Listbox.Options
                    className="absolute z-10 mt-1 px-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg border-gray-200 border-[0.5px] focus:outline-none sm:text-sm">
                    {voiceItems?.map((item: Item) => (
                      <Listbox.Option
                        key={item.value}
                        className={({ active }) =>
                          `relative cursor-pointer select-none py-2 pl-3 pr-9 rounded-lg hover:bg-gray-100 text-gray-700 ${active ? 'bg-gray-100' : ''
                          }`
                        }
                        value={item}
                        disabled={false}
                      >
                        {({ /* active, */ selected }) => (
                          <>
                            <span className={classNames('block', selected && 'font-normal')}>{item.name}</span>
                            {(selected || item.value === textToSpeechConfig.voice) && (
                              <span
                                className={classNames(
                                  'absolute inset-y-0 right-0 flex items-center pr-4 text-gray-700',
                                )}
                              >
                                <CheckIcon className="h-5 w-5" aria-hidden="true" />
                              </span>
                            )}
                          </>
                        )}
                      </Listbox.Option>
                    ))}
                  </Listbox.Options>
                </Transition>
              </div>
            </Listbox>
          </div>
          <div>
            <div
              className='mb-2 leading-[18px] text-[13px] font-semibold text-gray-800'>{t('appDebug.voice.voiceSettings.autoPlay')}</div>
            <RadioGroup
              className='space-x-3'
              options={[
                {
                  label: t('appDebug.voice.voiceSettings.autoPlayEnabled'),
                  value: TtsAutoPlay.enabled,
                },
                {
                  label: t('appDebug.voice.voiceSettings.autoPlayDisabled'),
                  value: TtsAutoPlay.disabled,
                },
              ]}
              value={textToSpeechConfig.autoPlay ? textToSpeechConfig.autoPlay : TtsAutoPlay.disabled}
              onChange={(value: TtsAutoPlay) => {
                setTextToSpeechConfig({
                  ...textToSpeechConfig,
                  autoPlay: value,
                })
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(VoiceParamConfig)
