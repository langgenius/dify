import type { EmailConfig, FormInputItem } from '../../types'
import type {
  Node,
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { RiArrowRightSFill } from '@remixicon/react'
import { noop, unionBy } from 'es-toolkit/compat'
import { memo, useCallback, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Divider from '@/app/components/base/divider'
import { getInputVars as doGetInputVars } from '@/app/components/base/prompt-editor/constants'
import FormItem from '@/app/components/workflow/nodes/_base/components/before-run-form/form-item'
import {
  getNodeInfoById,
  isConversationVar,
  isENV,
  isSystemVar,
} from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { InputVarType, VarType } from '@/app/components/workflow/types'
import { useAppContext } from '@/context/app-context'
import { useMembers } from '@/service/use-common'
import { useTestEmailSender } from '@/service/use-workflow'
import { isOutput } from '../../utils'
import EmailInput from './recipient/email-input'

const i18nPrefix = 'nodes.humanInput'

type EmailSenderModalProps = {
  nodeId: string
  deliveryId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  jumpToEmailConfigModal: () => void
  config?: EmailConfig
  formContent?: string
  formInputs?: FormInputItem[]
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
}

const getOriginVar = (valueSelector: string[], list: NodeOutPutVar[]) => {
  const targetVar = list.find(item => item.nodeId === valueSelector[0])
  if (!targetVar)
    return undefined

  let curr: Var[] | undefined = targetVar.vars
  for (let i = 1; i < valueSelector.length; i++) {
    const key = valueSelector[i]
    const isLast = i === valueSelector.length - 1
    const currentVar: Var | undefined = curr?.find(v => v.variable.replace('conversation.', '') === key)

    if (!currentVar)
      return undefined

    if (isLast)
      return currentVar

    if ((currentVar.type === VarType.object || currentVar.type === VarType.file) && Array.isArray(currentVar.children))
      curr = currentVar.children
    else
      return undefined
  }

  return undefined
}

const EmailSenderModal = ({
  nodeId,
  deliveryId,
  open,
  onOpenChange,
  jumpToEmailConfigModal,
  config,
  formContent,
  formInputs,
  nodesOutputVars = [],
  availableNodes = [],
}: EmailSenderModalProps) => {
  const { t } = useTranslation()
  const { userProfile, currentWorkspace } = useAppContext()
  const appDetail = useAppStore(state => state.appDetail)
  const { mutateAsync: testEmailSender } = useTestEmailSender()

  const debugEnabled = !!config?.debug_mode
  const onlyWholeTeam = config?.recipients?.whole_workspace && (!config?.recipients?.items || config?.recipients?.items.length === 0)
  const onlySpecificUsers = !config?.recipients?.whole_workspace && config?.recipients?.items && config?.recipients?.items.length > 0
  const combinedRecipients = config?.recipients?.whole_workspace && config?.recipients?.items && config?.recipients?.items.length > 0

  const { data: members } = useMembers()
  const accounts = members?.accounts || []

  const generatedInputs = useMemo(() => {
    const defaultValueSelectors = (formInputs || []).reduce((acc, input) => {
      if (input.default.type === 'variable') {
        acc.push(input.default.selector)
      }
      return acc
    }, [] as ValueSelector[])
    const valueSelectors = doGetInputVars((formContent || '') + (config?.body || ''))
    const variables = unionBy([...valueSelectors, ...defaultValueSelectors], item => item.join('.')).map((item) => {
      const varInfo = getNodeInfoById(availableNodes, item[0]!)?.data

      return {
        label: {
          nodeType: varInfo?.type,
          nodeName: varInfo?.title || availableNodes[0]?.data.title || '',
          variable: isSystemVar(item) ? item.join('.') : item[item.length - 1]!,
          isChatVar: isConversationVar(item),
        },
        variable: `#${item.join('.')}#`,
        value_selector: item,
        required: true,
      }
    })
    const varInputs = variables.filter(item => !isENV(item.value_selector) && !isOutput(item.value_selector)).map((item) => {
      const originalVar = getOriginVar(item.value_selector, nodesOutputVars)
      if (!originalVar) {
        return {
          label: item.label || item.variable,
          variable: item.variable,
          type: InputVarType.textInput,
          required: true,
          value_selector: item.value_selector,
        }
      }
      return {
        label: item.label || item.variable,
        variable: item.variable,
        type: originalVar.type === VarType.number ? InputVarType.number : InputVarType.textInput,
        required: true,
      }
    })
    return varInputs
  }, [availableNodes, config?.body, formContent, formInputs, nodesOutputVars])

  const [inputs, setInputs] = useState<Record<string, unknown>>({})
  const [collapsed, setCollapsed] = useState(!(generatedInputs.length > 0))
  const [sendingEmail, setSendingEmail] = useState(false)
  const [done, setDone] = useState(false)

  const handleValueChange = (variable: string, v: string) => {
    setInputs({
      ...inputs,
      [variable]: v,
    })
  }

  const confirmChecked = useMemo(() => {
    for (const variable of generatedInputs) {
      if (variable.required) {
        const value = inputs[variable.variable]
        if (value === undefined || value === null || value === '') {
          return false
        }
      }
    }
    return true
  }, [generatedInputs, inputs])

  const handleConfirm = useCallback(async () => {
    if (!confirmChecked)
      return
    setSendingEmail(true)
    try {
      await testEmailSender({
        appID: appDetail?.id || '',
        nodeID: nodeId,
        deliveryID: deliveryId,
        inputs,
      })
      setDone(true)
    }
    finally {
      setSendingEmail(false)
    }
  }, [confirmChecked, testEmailSender, appDetail?.id, nodeId, deliveryId, inputs])

  if (done) {
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
      >
        <DialogContent>
          <div className="space-y-2">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">{t(`${i18nPrefix}.deliveryMethod.emailSender.done`, { ns: 'workflow' })}</DialogTitle>
            {debugEnabled && (
              <div className="system-md-regular text-text-secondary">
                <Trans
                  i18nKey={`${i18nPrefix}.deliveryMethod.emailSender.debugDone`}
                  ns="workflow"
                  components={{ email: <span className="system-md-semibold text-text-secondary"></span> }}
                  values={{ email: userProfile.email }}
                />
              </div>
            )}
            {!debugEnabled && onlyWholeTeam && (
              <div className="system-md-regular text-text-secondary">
                <Trans
                  i18nKey={`${i18nPrefix}.deliveryMethod.emailSender.wholeTeamDone2`}
                  ns="workflow"
                  components={{ team: <span className="system-md-medium text-text-secondary"></span> }}
                  values={{ team: currentWorkspace.name.replace(/'/g, '’') }}
                />
              </div>
            )}
            {!debugEnabled && onlySpecificUsers && (
              <div className="system-md-regular text-text-secondary">{t(`${i18nPrefix}.deliveryMethod.emailSender.wholeTeamDone3`, { ns: 'workflow' })}</div>
            )}
            {!debugEnabled && combinedRecipients && (
              <div className="system-md-regular text-text-secondary">
                <Trans
                  i18nKey={`${i18nPrefix}.deliveryMethod.emailSender.wholeTeamDone1`}
                  ns="workflow"
                  components={{ team: <span className="system-md-medium text-text-secondary"></span> }}
                  values={{ team: currentWorkspace.name.replace(/'/g, '’') }}
                />
              </div>
            )}
          </div>
          {(onlySpecificUsers || combinedRecipients) && !debugEnabled && (
            <div className="mt-4">
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
          <div className="mt-6 flex flex-row-reverse gap-2">
            <Button
              variant="primary"
              className="w-[72px]"
              onClick={() => onOpenChange(false)}
            >
              {t('operation.ok', { ns: 'common' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        <DialogCloseButton />
        <div className="space-y-1 pr-8">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">{t(`${i18nPrefix}.deliveryMethod.emailSender.title`, { ns: 'workflow' })}</DialogTitle>
          {debugEnabled && (
            <>
              <div className="system-sm-regular text-text-secondary">{t(`${i18nPrefix}.deliveryMethod.emailSender.debugModeTip`, { ns: 'workflow' })}</div>
              <div className="system-sm-regular text-text-secondary">
                <Trans
                  i18nKey={`${i18nPrefix}.deliveryMethod.emailSender.debugModeTip2`}
                  ns="workflow"
                  components={{ email: <span className="system-sm-semibold text-text-primary"></span> }}
                  values={{ email: userProfile.email }}
                />
              </div>
            </>
          )}
          {!debugEnabled && onlyWholeTeam && (
            <div className="system-sm-regular text-text-secondary">
              <Trans
                i18nKey={`${i18nPrefix}.deliveryMethod.emailSender.wholeTeamTip2`}
                ns="workflow"
                components={{ team: <span className="system-sm-semibold text-text-primary"></span> }}
                values={{ team: currentWorkspace.name.replace(/'/g, '’') }}
              />
            </div>
          )}
          {!debugEnabled && onlySpecificUsers && (
            <div className="system-sm-regular text-text-secondary">{t(`${i18nPrefix}.deliveryMethod.emailSender.wholeTeamTip3`, { ns: 'workflow' })}</div>
          )}
          {!debugEnabled && combinedRecipients && (
            <div className="system-sm-regular text-text-secondary">
              <Trans
                i18nKey={`${i18nPrefix}.deliveryMethod.emailSender.wholeTeamTip1`}
                ns="workflow"
                components={{ team: <span className="system-sm-semibold text-text-primary"></span> }}
                values={{ team: currentWorkspace.name.replace(/'/g, '’') }}
              />
            </div>
          )}
        </div>
        {(onlySpecificUsers || combinedRecipients) && !debugEnabled && (
          <>
            <div className="mt-4">
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
            <div className="mt-1 system-xs-regular text-text-tertiary">
              <Trans
                i18nKey={`${i18nPrefix}.deliveryMethod.emailSender.tip`}
                ns="workflow"
                components={{
                  strong: (
                    <button
                      type="button"
                      onClick={jumpToEmailConfigModal}
                      className="inline cursor-pointer border-none bg-transparent p-0 text-left system-xs-regular text-text-accent"
                    />
                  ),
                }}
              />
            </div>
          </>
        )}
        {/* vars */}
        {generatedInputs.length > 0 && (
          <>
            <div>
              <Divider className="mt-4! mb-2! h-px! w-12! bg-divider-regular" />
            </div>
            <div className="py-2">
              <button
                type="button"
                aria-expanded={!collapsed}
                className="group flex h-6 cursor-pointer items-center border-none bg-transparent p-0 text-left"
                onClick={() => setCollapsed(!collapsed)}
              >
                <div className="mr-1 system-sm-semibold-uppercase text-text-secondary">{t(`${i18nPrefix}.deliveryMethod.emailSender.vars`, { ns: 'workflow' })}</div>
                <RiArrowRightSFill className={cn('h-4 w-4 text-text-quaternary group-hover:text-text-primary', !collapsed && 'rotate-90')} aria-hidden />
              </button>
              <div className="system-xs-regular text-text-tertiary">{t(`${i18nPrefix}.deliveryMethod.emailSender.varsTip`, { ns: 'workflow' })}</div>
              {!collapsed && (
                <div className="mt-3 space-y-4">
                  {generatedInputs.map((variable, index) => (
                    <div
                      key={variable.variable}
                      className="mb-4 last-of-type:mb-0"
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
        )}
        <div className="mt-6 flex flex-row-reverse gap-2">
          <Button
            disabled={sendingEmail || !confirmChecked}
            loading={sendingEmail}
            variant="primary"
            onClick={handleConfirm}
          >
            {t(`${i18nPrefix}.deliveryMethod.emailSender.send`, { ns: 'workflow' })}
          </Button>
          <Button
            className="w-[72px]"
            onClick={() => onOpenChange(false)}
          >
            {t('operation.cancel', { ns: 'common' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default memo(EmailSenderModal)
