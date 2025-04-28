'use client'
import React, { useCallback, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine, RiCommandLine, RiCornerDownLeftLine, RiArrowDownSLine } from '@remixicon/react'
import { useDebounceFn, useKeyPress } from 'ahooks'
import { RiCloseLine as RemixIconCloseLine } from '@remixicon/react'
import cn from 'classnames'
import { Users01, UsersPlus } from '@/app/components/base/icons/src/vender/solid/users'
import { Check } from '@/app/components/base/icons/src/vender/line/general'
import AppIconPicker from '../../base/app-icon-picker'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import Switch from '@/app/components/base/switch'
import Toast from '@/app/components/base/toast'
import AppIcon from '@/app/components/base/app-icon'
import Avatar from '@/app/components/base/avatar'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import type { AppIconType } from '@/types/app'
import { fetchMembers } from '@/service/common'
import { noop } from 'lodash-es'
import type { Member } from '@/models/common'

export type CreateAppModalProps = {
  show: boolean
  isEditModal?: boolean
  appName: string
  appDescription: string
  appIconType: AppIconType | null
  appIcon: string
  appIconBackground?: string | null
  appIconUrl?: string | null
  appMode?: string
  appUseIconAsAnswerIcon?: boolean
  appPermission?: string
  appSelectedMemberIDs?: string[]
  onConfirm: (info: {
    name: string
    icon_type: AppIconType
    icon: string
    icon_background?: string
    description: string
    use_icon_as_answer_icon?: boolean
    permission: 'only_me' | 'all_team_members' | 'partial_members'
    partial_member_list?: string[]
  }) => Promise<void>
  confirmDisabled?: boolean
  onHide: () => void
}

const CreateAppModal = ({
  show = false,
  isEditModal = false,
  appIconType,
  appIcon: _appIcon,
  appIconBackground,
  appIconUrl,
  appName,
  appDescription,
  appMode,
  appUseIconAsAnswerIcon,
  appPermission = 'only_me',
  appSelectedMemberIDs,
  onConfirm,
  confirmDisabled,
  onHide,
}: CreateAppModalProps) => {
  const { t } = useTranslation()

  const [name, setName] = React.useState(appName)
  const [appIcon, setAppIcon] = useState(
    () => appIconType === 'image'
      ? { type: 'image' as const, fileId: _appIcon, url: appIconUrl }
      : { type: 'emoji' as const, icon: _appIcon, background: appIconBackground },
  )
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const [description, setDescription] = useState(appDescription || '')
  const [useIconAsAnswerIcon, setUseIconAsAnswerIcon] = useState(appUseIconAsAnswerIcon || false)
  const [permission, setPermission] = useState<'only_me' | 'all_team_members' | 'partial_members'>(appPermission)
  const [selectedMemberIDs, setSelectedMemberIDs] = useState<string[]>(appSelectedMemberIDs || [])
  const [isPermissionSelectorOpen, setIsPermissionSelectorOpen] = useState(false)

  const [keywords, setKeywords] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')
  const [memberList, setMemberList] = useState<Member[]>([])

  const { userProfile, currentWorkspace } = useAppContext()
  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)

  const submit = useCallback(() => {
    if (!name.trim()) {
      Toast.notify({ type: 'error', message: t('explore.appCustomize.nameRequired') })
      return
    }
    onConfirm({
      name,
      icon_type: appIcon.type,
      icon: appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId,
      icon_background: appIcon.type === 'emoji' ? appIcon.background! : undefined,
      description,
      use_icon_as_answer_icon: useIconAsAnswerIcon,
      permission,
      partial_member_list: permission === 'partial_members' ? selectedMemberIDs : [],
    })
    onHide()
  }, [name, appIcon, description, useIconAsAnswerIcon, permission, selectedMemberIDs, onConfirm, onHide, t])

  const { run: handleSearch } = useDebounceFn(() => {
    setSearchKeywords(keywords)
  }, { wait: 500 })

  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }

  const selectMember = (member: Member) => {
    if (selectedMemberIDs.includes(member.id))
      setSelectedMemberIDs(selectedMemberIDs.filter(v => v !== member.id))
    else
      setSelectedMemberIDs([...selectedMemberIDs, member.id])
  }

  const selectedMembersDisplay = React.useMemo(() => {
    return [
      userProfile,
      ...memberList.filter(member => member.id !== userProfile.id).filter(member => selectedMemberIDs.includes(member.id)),
    ].map(member => member.name).join(', ')
  }, [userProfile, selectedMemberIDs, memberList])

  const showMe = React.useMemo(() => {
    return userProfile.name.includes(searchKeywords) || userProfile.email.includes(searchKeywords)
  }, [searchKeywords, userProfile])

  const filteredMemberList = React.useMemo(() => {
    return memberList.filter(member => (member.name.includes(searchKeywords) || member.email.includes(searchKeywords)) && member.id !== userProfile.id)
  }, [memberList, searchKeywords, userProfile])

  useEffect(() => {
    if (isPermissionSelectorOpen && permission === 'partial_members') {
      (async () => {
        try {
          const { accounts } = await fetchMembers({ url: '/workspaces/current/members', params: {} })
          setMemberList(accounts || [])
        } catch (e) {
          console.error('Failed to fetch members', e)
          setMemberList([])
        }
      })()
    }
  }, [isPermissionSelectorOpen, permission])

  const { run: handleSubmit } = useDebounceFn(submit, { wait: 300 })

  useKeyPress(['meta.enter', 'ctrl.enter'], () => {
    if (show && !(!isEditModal && isAppsFull) && name.trim())
      handleSubmit()
  })

  useKeyPress('esc', () => {
    if (show)
      onHide()
  })

  return (
    <>
      <Modal
        isShow={show}
        onClose={noop}
        className='relative !max-w-[480px] px-8'
      >
        <div className='absolute right-4 top-4 cursor-pointer p-2' onClick={onHide}>
          <RiCloseLine className='h-4 w-4 text-text-tertiary' />
        </div>
        {isEditModal && (
          <div className='mb-9 text-xl font-semibold leading-[30px] text-text-primary'>{t('app.editAppTitle')}</div>
        )}
        {!isEditModal && (
          <div className='mb-9 text-xl font-semibold leading-[30px] text-text-primary'>{t('explore.appCustomize.title', { name: appName })}</div>
        )}
        <div className='mb-9'>
          {/* icon & name */}
          <div className='pt-2'>
            <div className='py-2 text-sm font-medium leading-[20px] text-text-primary'>{t('app.newApp.captionName')}</div>
            <div className='flex items-center justify-between space-x-2'>
              <AppIcon
                size='large'
                onClick={() => { setShowAppIconPicker(true) }}
                className='cursor-pointer'
                iconType={appIcon.type}
                icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
                background={appIcon.type === 'image' ? undefined : appIcon.background}
                imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
              />
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('app.newApp.appNamePlaceholder') || ''}
                className='h-10 grow'
              />
            </div>
          </div>
          {/* description */}
          <div className='pt-2'>
            <div className='py-2 text-sm font-medium leading-[20px] text-text-primary'>{t('app.newApp.captionDescription')}</div>
            <Textarea
              className='resize-none'
              placeholder={t('app.newApp.appDescriptionPlaceholder') || ''}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
          {/* answer icon */}
          {isEditModal && (appMode === 'chat' || appMode === 'advanced-chat' || appMode === 'agent-chat') && (
            <div className='pt-2'>
              <div className='flex items-center justify-between'>
                <div className='py-2 text-sm font-medium leading-[20px] text-text-primary'>{t('app.answerIcon.title')}</div>
                <Switch
                  defaultValue={useIconAsAnswerIcon}
                  onChange={v => setUseIconAsAnswerIcon(v)}
                />
              </div>
              <p className='body-xs-regular text-text-tertiary'>{t('app.answerIcon.descriptionInExplore')}</p>
            </div>
          )}
          {/* permissions */}
          {isEditModal && (
            <div className='pt-2'>
              <div className='py-2 text-sm font-medium leading-[20px] text-text-primary'>{t('app.permissions')}</div>
              <PortalToFollowElem
                open={isPermissionSelectorOpen}
                onOpenChange={setIsPermissionSelectorOpen}
                placement='bottom-start'
                offset={4}
              >
                <PortalToFollowElemTrigger
                  onClick={() => setIsPermissionSelectorOpen(v => !v)}
                  className='block'
                >
                  <div className={cn('flex cursor-pointer items-center rounded-lg bg-components-input-bg-normal px-3 py-[6px] hover:bg-state-base-hover-alt',
                    isPermissionSelectorOpen && 'bg-state-base-hover-alt',
                  )}>
                    {permission === 'only_me' && (
                      <>
                        <Avatar avatar={userProfile.avatar_url} name={userProfile.name} className='mr-2 shrink-0' size={24} />
                        <div className='mr-2 grow text-sm leading-5 text-components-input-text-filled'>{t('app.permissionsOnlyMe')}</div>
                      </>
                    )}
                    {permission === 'all_team_members' && (
                      <>
                        <div className='mr-2 flex h-6 w-6 items-center justify-center rounded-lg bg-[#EEF4FF]'>
                          <Users01 className='h-3.5 w-3.5 text-[#444CE7]' />
                        </div>
                        <div className='mr-2 grow text-sm leading-5 text-components-input-text-filled'>{t('app.permissionsAllMember')}</div>
                      </>
                    )}
                    {permission === 'partial_members' && (
                      <>
                        <div className='mr-2 flex h-6 w-6 items-center justify-center rounded-lg bg-[#EEF4FF]'>
                          <Users01 className='h-3.5 w-3.5 text-[#444CE7]' />
                        </div>
                        <div title={selectedMembersDisplay} className='mr-2 grow truncate text-sm leading-5 text-components-input-text-filled'>{selectedMembersDisplay}</div>
                      </>
                    )}
                    <RiArrowDownSLine className={cn('h-4 w-4 shrink-0 text-text-secondary')} />
                  </div>
                </PortalToFollowElemTrigger>
                <PortalToFollowElemContent className='z-[1002]'>
                  <div className='w-[480px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-sm'>
                    <div className='p-1'>
                      <div className='cursor-pointer rounded-lg py-1 pl-3 pr-2 hover:bg-state-base-hover' onClick={() => { setPermission('only_me'); setIsPermissionSelectorOpen(false); }}>
                        <div className='flex items-center gap-2'>
                          <Avatar avatar={userProfile.avatar_url} name={userProfile.name} className='mr-2 shrink-0' size={24} />
                          <div className='mr-2 grow text-sm leading-5 text-text-primary'>{t('app.permissionsOnlyMe')}</div>
                          {permission === 'only_me' && <Check className='h-4 w-4 text-primary-600' />}
                        </div>
                      </div>
                      <div className='cursor-pointer rounded-lg py-1 pl-3 pr-2 hover:bg-state-base-hover' onClick={() => { setPermission('all_team_members'); setIsPermissionSelectorOpen(false); }}>
                        <div className='flex items-center gap-2'>
                          <div className='mr-2 flex h-6 w-6 items-center justify-center rounded-lg bg-[#EEF4FF]'>
                            <Users01 className='h-3.5 w-3.5 text-[#444CE7]' />
                          </div>
                          <div className='mr-2 grow text-sm leading-5 text-text-primary'>{t('app.permissionsAllMember')}</div>
                          {permission === 'all_team_members' && <Check className='h-4 w-4 text-primary-600' />}
                        </div>
                      </div>
                      <div className='cursor-pointer rounded-lg py-1 pl-3 pr-2 hover:bg-state-base-hover' onClick={() => { setPermission('partial_members'); setSelectedMemberIDs([userProfile.id]); }}>
                        <div className='flex items-center gap-2'>
                          <div className={cn('mr-2 flex h-6 w-6 items-center justify-center rounded-lg bg-[#FFF6ED]', permission === 'partial_members' && '!bg-[#EEF4FF]')}>
                            <UsersPlus className={cn('h-3.5 w-3.5 text-[#FB6514]', permission === 'partial_members' && '!text-[#444CE7]')} />
                          </div>
                          <div className='mr-2 grow text-sm leading-5 text-text-primary'>{t('app.permissionsInvitedMembers')}</div>
                          {permission === 'partial_members' && <Check className='h-4 w-4 text-primary-600' />}
                        </div>
                      </div>
                    </div>
                    {permission === 'partial_members' && (
                      <div className='max-h-[360px] overflow-y-auto border-t-[1px] border-divider-regular pb-1 pl-1 pr-1'>
                        <div className='sticky left-0 top-0 z-10 bg-white p-2 pb-1'>
                          <Input
                            showLeftIcon
                            showClearIcon
                            value={keywords}
                            onChange={e => handleKeywordsChange(e.target.value)}
                            onClear={() => handleKeywordsChange('')}
                            placeholder={t('common.operation.search') || ''}
                          />
                        </div>
                        {showMe && (
                          <div className='flex items-center gap-2 rounded-lg py-1 pl-3 pr-[10px]'>
                            <Avatar avatar={userProfile.avatar_url} name={userProfile.name} className='shrink-0' size={24} />
                            <div className='grow'>
                              <div className='truncate text-[13px] font-medium leading-[18px] text-text-secondary'>
                                {userProfile.name}
                                <span className='text-xs font-normal text-text-tertiary'>{` (${t('datasetSettings.form.me')})`}</span>
                              </div>
                              <div className='truncate text-xs leading-[18px] text-text-tertiary'>{userProfile.email}</div>
                            </div>
                            <Check className='h-4 w-4 shrink-0 text-text-accent opacity-30' />
                          </div>
                        )}
                        {filteredMemberList.map(member => (
                          <div key={member.id} className='flex cursor-pointer items-center gap-2 rounded-lg py-1 pl-3 pr-[10px] hover:bg-state-base-hover' onClick={() => selectMember(member)}>
                            <Avatar avatar={member.avatar_url} name={member.name} className='shrink-0' size={24} />
                            <div className='grow'>
                              <div className='truncate text-[13px] font-medium leading-[18px] text-text-secondary'>{member.name}</div>
                              <div className='truncate text-xs leading-[18px] text-text-tertiary'>{member.email}</div>
                            </div>
                            {selectedMemberIDs.includes(member.id) && <Check className='h-4 w-4 shrink-0 text-text-accent' />}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </PortalToFollowElemContent>
              </PortalToFollowElem>
            </div>
          )}
          {!isEditModal && isAppsFull && <AppsFull className='mt-4' loc='app-explore-create' />}
        </div>
        <div className='flex flex-row-reverse'>
          <Button
            disabled={(!isEditModal && isAppsFull) || !name.trim() || confirmDisabled}
            className='ml-2 w-24 gap-1'
            variant='primary'
            onClick={handleSubmit}
          >
            <span>{!isEditModal ? t('common.operation.create') : t('common.operation.save')}</span>
            <div className='flex gap-0.5'>
              <RiCommandLine size={14} className='system-kbd rounded-sm bg-components-kbd-bg-white p-0.5' />
              <RiCornerDownLeftLine size={14} className='system-kbd rounded-sm bg-components-kbd-bg-white p-0.5' />
            </div>
          </Button>
          <Button className='w-24' onClick={onHide}>{t('common.operation.cancel')}</Button>
        </div>
      </Modal>
      {showAppIconPicker && <AppIconPicker
        onSelect={(payload) => {
          setAppIcon(payload)
          setShowAppIconPicker(false)
        }}
        onClose={() => {
          setAppIcon(appIconType === 'image'
            ? { type: 'image' as const, url: appIconUrl, fileId: _appIcon }
            : { type: 'emoji' as const, icon: _appIcon, background: appIconBackground })
          setShowAppIconPicker(false)
        }}
      />}
    </>
  )
}

export default CreateAppModal