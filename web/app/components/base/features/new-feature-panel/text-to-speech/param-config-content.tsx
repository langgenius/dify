'use client'
import useSWR from 'swr'
import { produce } from 'immer'
import React, { Fragment } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import { Listbox, ListboxButton, ListboxOption, ListboxOptions, Transition } from '@headlessui/react'
import { CheckIcon, ChevronDownIcon } from '@heroicons/react/20/solid'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import type { Item } from '@/app/components/base/select'
import { fetchAppVoices } from '@/service/apps'
import Tooltip from '@/app/components/base/tooltip'
import Switch from '@/app/components/base/switch'
import AudioBtn from '@/app/components/base/audio-btn'
import { languages } from '@/i18n-config/language'
import { TtsAutoPlay } from '@/types/app'
import type { OnFeaturesChange } from '@/app/components/base/features/types'
import classNames from '@/utils/classnames'

type VoiceParamConfigProps = {
  onClose: () => void
  onChange?: OnFeaturesChange
}
const VoiceParamConfig = ({
  onClose,
  onChange,
}: VoiceParamConfigProps) => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const matched = pathname.match(/\/app\/([^/]+)/)
  const appId = (matched?.length && matched[1]) ? matched[1] : ''
  const text2speech = useFeatures(state => state.features.text2speech)
  const featuresStore = useFeaturesStore()

  let languageItem = languages.find(item => item.value === text2speech?.language)
  if (languages && !languageItem)
    languageItem = languages[0]
  const localLanguagePlaceholder = languageItem?.name || t('common.placeholder.select')

  const language = languageItem?.value
  const voiceItems = useSWR({ appId, language }, fetchAppVoices).data
  let voiceItem = voiceItems?.find(item => item.value === text2speech?.voice)
  if (voiceItems && !voiceItem)
    voiceItem = voiceItems[0]
  const localVoicePlaceholder = voiceItem?.name || t('common.placeholder.select')

  const handleChange = (value: Record<string, string>) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()

    const newFeatures = produce(features, (draft) => {
      draft.text2speech = {
        ...draft.text2speech,
        ...value,
      }
    })

    setFeatures(newFeatures)
    if (onChange)
      onChange()
  }

  return (
    <>
      <div className='mb-4 flex items-center justify-between'>
        <div className='system-xl-semibold text-text-primary'>{t('appDebug.voice.voiceSettings.title')}</div>
        <div className='cursor-pointer p-1' onClick={onClose}><RiCloseLine className='h-4 w-4 text-text-tertiary' /></div>
      </div>
      <div className='mb-3'>
        <div className='system-sm-semibold mb-1 flex items-center py-1 text-text-secondary'>
          {t('appDebug.voice.voiceSettings.language')}
          <Tooltip
            popupContent={
              <div className='w-[180px]'>
                {t('appDebug.voice.voiceSettings.resolutionTooltip').split('\n').map(item => (
                  <div key={item}>{item}
                  </div>
                ))}
              </div>
            }
          />
        </div>
        <Listbox
          value={languageItem}
          onChange={(value: Item) => {
            handleChange({
              language: String(value.value),
            })
          }}
        >
          <div className='relative h-8'>
            <ListboxButton
              className={'h-full w-full cursor-pointer rounded-lg border-0 bg-components-input-bg-normal py-1.5 pl-3 pr-10 focus-visible:bg-state-base-hover focus-visible:outline-none group-hover:bg-state-base-hover sm:text-sm sm:leading-6'}>
              <span className={classNames('block truncate text-left text-text-secondary', !languageItem?.name && 'text-text-tertiary')}>
                {languageItem?.name ? t(`common.voice.language.${languageItem?.value.replace('-', '')}`) : localLanguagePlaceholder}
              </span>
              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                <ChevronDownIcon
                  className="h-4 w-4 text-text-tertiary"
                  aria-hidden="true"
                />
              </span>
            </ListboxButton>
            <Transition
              as={Fragment}
              leave="transition ease-in duration-100"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >

              <ListboxOptions
                className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border-[0.5px] border-components-panel-border bg-components-panel-bg px-1 py-1 text-base shadow-lg focus:outline-none sm:text-sm">
                {languages.map((item: Item) => (
                  <ListboxOption
                    key={item.value}
                    className={
                      'relative cursor-pointer select-none rounded-lg py-2 pl-3 pr-9 text-text-secondary hover:bg-state-base-hover data-[active]:bg-state-base-active'
                    }
                    value={item}
                    disabled={false}
                  >
                    {({ /* active, */ selected }) => (
                      <>
                        <span
                          className={classNames('block', selected && 'font-normal')}>{t(`common.voice.language.${(item.value).toString().replace('-', '')}`)}</span>
                        {(selected || item.value === text2speech?.language) && (
                          <span
                            className={classNames(
                              'absolute inset-y-0 right-0 flex items-center pr-4 text-text-secondary',
                            )}
                          >
                            <CheckIcon className="h-4 w-4" aria-hidden="true" />
                          </span>
                        )}
                      </>
                    )}
                  </ListboxOption>
                ))}
              </ListboxOptions>
            </Transition>
          </div>
        </Listbox>
      </div>
      <div className='mb-3'>
        <div className='system-sm-semibold mb-1 py-1 text-text-secondary'>
          {t('appDebug.voice.voiceSettings.voice')}
        </div>
        <div className='flex items-center gap-1'>
          <Listbox
            value={voiceItem ?? {}}
            disabled={!languageItem}
            onChange={(value: Item) => {
              handleChange({
                voice: String(value.value),
              })
            }}
          >
            <div className={'relative h-8 grow'}>
              <ListboxButton
                className={'h-full w-full cursor-pointer rounded-lg border-0 bg-components-input-bg-normal py-1.5 pl-3 pr-10 focus-visible:bg-state-base-hover focus-visible:outline-none group-hover:bg-state-base-hover sm:text-sm sm:leading-6'}>
                <span
                  className={classNames('block truncate text-left text-text-secondary', !voiceItem?.name && 'text-text-tertiary')}>{voiceItem?.name ?? localVoicePlaceholder}</span>
                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                  <ChevronDownIcon
                    className="h-4 w-4 text-text-tertiary"
                    aria-hidden="true"
                  />
                </span>
              </ListboxButton>
              <Transition
                as={Fragment}
                leave="transition ease-in duration-100"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
              >

                <ListboxOptions
                  className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border-[0.5px] border-components-panel-border bg-components-panel-bg px-1 py-1 text-base shadow-lg focus:outline-none sm:text-sm">
                  {voiceItems?.map((item: Item) => (
                    <ListboxOption
                      key={item.value}
                      className={
                        'relative cursor-pointer select-none rounded-lg py-2 pl-3 pr-9 text-text-secondary hover:bg-state-base-hover data-[active]:bg-state-base-active'
                      }
                      value={item}
                      disabled={false}
                    >
                      {({ /* active, */ selected }) => (
                        <>
                          <span className={classNames('block', selected && 'font-normal')}>{item.name}</span>
                          {(selected || item.value === text2speech?.voice) && (
                            <span
                              className={classNames(
                                'absolute inset-y-0 right-0 flex items-center pr-4 text-text-secondary',
                              )}
                            >
                              <CheckIcon className="h-4 w-4" aria-hidden="true" />
                            </span>
                          )}
                        </>
                      )}
                    </ListboxOption>
                  ))}
                </ListboxOptions>
              </Transition>
            </div>
          </Listbox>
          {languageItem?.example && (
            <div className='h-8 shrink-0 rounded-lg bg-components-button-tertiary-bg p-1'>
              <AudioBtn
                value={languageItem?.example}
                isAudition
                voice={text2speech?.voice}
                noCache
              />
            </div>
          )}
        </div>
      </div>
      <div>
        <div className='system-sm-semibold mb-1 py-1 text-text-secondary'>
          {t('appDebug.voice.voiceSettings.autoPlay')}
        </div>
        <Switch className='shrink-0'
          defaultValue={text2speech?.autoPlay === TtsAutoPlay.enabled}
          onChange={(value: boolean) => {
            handleChange({
              autoPlay: value ? TtsAutoPlay.enabled : TtsAutoPlay.disabled,
            })
          }}
        />
      </div>
    </>
  )
}

export default React.memo(VoiceParamConfig)
