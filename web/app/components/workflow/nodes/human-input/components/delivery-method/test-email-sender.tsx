import { memo, useCallback, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Trans, useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { RiArrowRightSFill, RiCloseLine } from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import EmailInput from './recipient/email-input'
import FormItem from '@/app/components/workflow/nodes/_base/components/before-run-form/form-item'
import { getInputVars as doGetInputVars } from '@/app/components/base/prompt-editor/constants'
import {
  getNodeInfoById,
  isConversationVar,
  isENV,
  isSystemVar,
} from '@/app/components/workflow/nodes/_base/components/variable/utils'
import type { EmailConfig } from '../../types'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import { InputVarType, VarType } from '@/app/components/workflow/types'
import { fetchMembers } from '@/service/common'
import { noop, unionBy } from 'lodash-es'
import { isOutput } from '../../utils'
import cn from '@/utils/classnames'

const i18nPrefix = 'workflow.nodes.humanInput'

type EmailConfigureModalProps = {
  isShow: boolean
  onClose: () => void
  onConfirm: (data: any) => void
  config?: EmailConfig
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
}

const getOriginVar = (valueSelector: string[], list: NodeOutPutVar[]) => {
  const targetVar = list.find(item => item.nodeId === valueSelector[0])
  if (!targetVar)
    return undefined

  let curr: any = targetVar.vars
  for (let i = 1; i < valueSelector.length; i++) {
    const key = valueSelector[i]
    const isLast = i === valueSelector.length - 1

    if (Array.isArray(curr))
      curr = curr.find((v: any) => v.variable.replace('conversation.', '') === key)

    if (isLast)
      return curr
    else if (curr?.type === VarType.object || curr?.type === VarType.file)
      curr = curr.children
  }

  return undefined
}

const EmailSenderModal = ({
  isShow,
  onClose,
  onConfirm,
  config,
  nodesOutputVars = [],
  availableNodes = [],
}: EmailConfigureModalProps) => {
  const { t } = useTranslation()
  const { userProfile, currentWorkspace } = useAppContext()

  const debugEnabled = !!config?.debug_mode
  const onlyWholeTeam = config?.recipients?.whole_workspace && (!config?.recipients?.items || config?.recipients?.items.length === 0)
  const onlySpecificUsers = !config?.recipients?.whole_workspace && config?.recipients?.items && config?.recipients?.items.length > 0
  const combinedRecipients = config?.recipients?.whole_workspace && config?.recipients?.items && config?.recipients?.items.length > 0

  const { data: members } = useSWR(
    {
      url: '/workspaces/current/members',
      params: {},
    },
    fetchMembers,
  )
  const accounts = members?.accounts || []

  const generatedInputs = useMemo(() => {
    const valueSelectors = doGetInputVars(config?.body || '')
    const variables = unionBy(valueSelectors, item => item.join('.')).map((item) => {
      const varInfo = getNodeInfoById(availableNodes, item[0])?.data

      return {
        label: {
          nodeType: varInfo?.type,
          nodeName: varInfo?.title || availableNodes[0]?.data.title, // default start node title
          variable: isSystemVar(item) ? item.join('.') : item[item.length - 1],
          isChatVar: isConversationVar(item),
        },
        variable: `#${item.join('.')}#`,
        value_selector: item,
      }
    })
    const varInputs = variables.filter(item => !isENV(item.value_selector) && !isOutput(item.value_selector)).map((item) => {
      const originalVar = getOriginVar(item.value_selector, nodesOutputVars)
      if (!originalVar) {
        return {
          label: item.label || item.variable,
          variable: item.variable,
          type: InputVarType.textInput,
          required: false,
          value_selector: item.value_selector,
        }
      }
      return {
        label: item.label || item.variable,
        variable: item.variable,
        type: originalVar.type === VarType.number ? InputVarType.number : InputVarType.textInput,
        required: false,
      }
    })
    return varInputs
  }, [availableNodes, config?.body, nodesOutputVars])

  const [inputs, setInputs] = useState<Record<string, any>>({})
  const [collapsed, setCollapsed] = useState(true)
  const [done, setDone] = useState(false)

  const handleValueChange = (variable: string, v: string) => {
    setInputs({
      ...inputs,
      [variable]: v,
    })
  }

  const handleConfirm = useCallback(() => {
    // TODO send api
    setDone(true)
  }, [onConfirm])

  if (done) {
    return (
      <Modal
        isShow={isShow}
        onClose={noop}
        className='relative !max-w-[480px] !p-0'
      >
        <div className='space-y-2 p-6 pb-3'>
          <div className='title-2xl-semi-bold text-text-primary'>{t(`${i18nPrefix}.deliveryMethod.emailSender.done`)}</div>
          {debugEnabled && (
            <div className='system-md-regular text-text-secondary'>
              <Trans
                i18nKey={`${i18nPrefix}.deliveryMethod.emailSender.debugDone`}
                components={{ email: <span className='system-md-semibold text-text-secondary'></span> }}
                values={{ email: userProfile.email }}
              />
            </div>
          )}
          {!debugEnabled && onlyWholeTeam && (
            <div className='system-md-regular text-text-secondary'>
              <Trans
                i18nKey={`${i18nPrefix}.deliveryMethod.emailSender.wholeTeamDone2`}
                components={{ team: <span className='system-md-medium text-text-secondary'></span> }}
                values={{ team: currentWorkspace.name.replace(/'/g, '’') }}
              />
            </div>
          )}
          {!debugEnabled && onlySpecificUsers && (
            <div className='system-md-regular text-text-secondary'>{t(`${i18nPrefix}.deliveryMethod.emailSender.wholeTeamDone3`)}</div>
          )}
          {!debugEnabled && combinedRecipients && (
            <div className='system-md-regular text-text-secondary'>
              <Trans
                i18nKey={`${i18nPrefix}.deliveryMethod.emailSender.wholeTeamDone1`}
                components={{ team: <span className='system-md-medium text-text-secondary'></span> }}
                values={{ team: currentWorkspace.name.replace(/'/g, '’') }}
              />
            </div>
          )}
        </div>
        {(onlySpecificUsers || combinedRecipients) && (
          <div className='px-5'>
            <EmailInput
              disabled
              email={userProfile.email}
              value={config?.recipients?.items}
              list={accounts}
              onDelete={noop}
              onSelect={noop}
              onAdd={noop}
            />
          </div>
        )}
        <div className='flex flex-row-reverse gap-2 p-6 pt-5'>
          <Button
            variant='primary'
            className='w-[72px]'
            onClick={onClose}
          >
            {t('common.operation.ok')}
          </Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      isShow={isShow}
      onClose={noop}
      className='relative !max-w-[480px] !p-0'
    >
      <div className='absolute right-5 top-5 cursor-pointer p-1.5' onClick={onClose}>
        <RiCloseLine className='h-5 w-5 text-text-tertiary' />
      </div>
      <div className='space-y-1 p-6 pb-3'>
        <div className='title-2xl-semi-bold text-text-primary'>{t(`${i18nPrefix}.deliveryMethod.emailSender.title`)}</div>
        {debugEnabled && (
          <>
            <div className='system-sm-regular text-text-secondary'>{t(`${i18nPrefix}.deliveryMethod.emailSender.debugModeTip`)}</div>
            <div className='system-sm-regular text-text-secondary'>
              <Trans
                i18nKey={`${i18nPrefix}.deliveryMethod.emailSender.debugModeTip2`}
                components={{ email: <span className='system-sm-semibold text-text-primary'></span> }}
                values={{ email: userProfile.email }}
              />
            </div>
          </>
        )}
        {!debugEnabled && onlyWholeTeam && (
          <div className='system-sm-regular text-text-secondary'>
            <Trans
              i18nKey={`${i18nPrefix}.deliveryMethod.emailSender.wholeTeamTip2`}
              components={{ team: <span className='system-sm-semibold text-text-primary'></span> }}
              values={{ team: currentWorkspace.name.replace(/'/g, '’') }}
            />
          </div>
        )}
        {!debugEnabled && onlySpecificUsers && (
          <div className='system-sm-regular text-text-secondary'>{t(`${i18nPrefix}.deliveryMethod.emailSender.wholeTeamTip3`)}</div>
        )}
        {!debugEnabled && combinedRecipients && (
          <div className='system-sm-regular text-text-secondary'>
            <Trans
              i18nKey={`${i18nPrefix}.deliveryMethod.emailSender.wholeTeamTip1`}
              components={{ team: <span className='system-sm-semibold text-text-primary'></span> }}
              values={{ team: currentWorkspace.name.replace(/'/g, '’') }}
            />
          </div>
        )}
      </div>
      {(onlySpecificUsers || combinedRecipients) && (
        <>
          <div className='px-5'>
            <EmailInput
              disabled
              email={userProfile.email}
              value={config?.recipients?.items}
              list={accounts}
              onDelete={noop}
              onSelect={noop}
              onAdd={noop}
            />
          </div>
          <div className='system-xs-regular px-6 pt-1 text-text-tertiary'>
            <Trans
              i18nKey={`${i18nPrefix}.deliveryMethod.emailSender.tip`}
              components={{ strong: <span className='system-xs-regular text-text-accent'></span> }}
            />
          </div>
        </>
      )}
      {/* vars */}
      <>
        <div className='px-6'>
          <Divider className='!mb-2 !mt-4 !h-px !w-12 bg-divider-regular'/>
        </div>
        <div className='px-6 py-2'>
          <div className='group flex h-6 cursor-pointer items-center' onClick={() => setCollapsed(!collapsed)}>
            <div className='system-sm-semibold-uppercase mr-1 text-text-secondary'>{t(`${i18nPrefix}.deliveryMethod.emailSender.vars`)}</div>
            <div className='system-xs-regular text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.emailSender.optional`)}</div>
            <RiArrowRightSFill className={cn('h-4 w-4 text-text-quaternary group-hover:text-text-primary', !collapsed && 'rotate-90')} />
          </div>
          <div className='system-xs-regular text-text-tertiary'>{t(`${i18nPrefix}.deliveryMethod.emailSender.varsTip`)}</div>
          {!collapsed && (
            <div className='mt-3 space-y-4'>
              {generatedInputs.map((variable, index) => (
                <div
                  key={variable.variable}
                  className='mb-4 last-of-type:mb-0'
                >
                  <FormItem
                    autoFocus={index === 0}
                    payload={variable}
                    value={inputs[variable.variable]}
                    onChange={v => handleValueChange(variable.variable, v)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </>
      <div className='flex flex-row-reverse gap-2 p-6 pt-5'>
        <Button
          variant='primary'
          onClick={handleConfirm}
        >
          {t(`${i18nPrefix}.deliveryMethod.emailSender.send`)}
        </Button>
        <Button
          className='w-[72px]'
          onClick={onClose}
        >
          {t('common.operation.cancel')}
        </Button>
      </div>
    </Modal>
  )
}

export default memo(EmailSenderModal)
