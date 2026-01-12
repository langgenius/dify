'use client'
import type { FC } from 'react'
import type { SubGraphModalProps } from './types'
import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import { RiCloseLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { Fragment, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Agent } from '@/app/components/base/icons/src/vender/workflow'
import SubGraphCanvas from './sub-graph-canvas'

const SubGraphModal: FC<SubGraphModalProps> = ({
  isOpen,
  onClose,
  toolNodeId,
  paramKey,
  sourceVariable,
  agentName,
  agentNodeId,
}) => {
  const { t } = useTranslation()

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[60]" onClose={noop}>
        <TransitionChild>
          <div className="fixed inset-0 bg-background-overlay duration-300 ease-in data-[closed]:opacity-0 data-[enter]:opacity-100 data-[leave]:opacity-0" />
        </TransitionChild>
        <div className="fixed inset-0 overflow-hidden">
          <div className="flex h-full w-full items-center justify-center px-[10px] pb-[4px] pt-[24px]">
            <TransitionChild>
              <DialogPanel className="flex h-full w-full flex-col overflow-hidden rounded-2xl bg-components-panel-bg shadow-xl duration-100 ease-in data-[closed]:scale-95 data-[enter]:scale-100 data-[leave]:scale-95 data-[closed]:opacity-0 data-[enter]:opacity-100 data-[leave]:opacity-0">
                <div className="flex h-14 shrink-0 items-center justify-between border-b border-divider-subtle px-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-util-colors-indigo-indigo-500">
                      <Agent className="h-4 w-4 text-text-primary-on-surface" />
                    </div>
                    <span className="system-md-semibold text-text-primary">
                      @
                      {agentName}
                      {' '}
                      {t('subGraphModal.title', { ns: 'workflow' })}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-state-base-hover"
                    onClick={onClose}
                  >
                    <RiCloseLine className="h-5 w-5 text-text-tertiary" />
                  </button>
                </div>

                <div className="bg-workflow-canvas-wrapper relative flex-1 overflow-hidden">
                  <SubGraphCanvas
                    toolNodeId={toolNodeId}
                    paramKey={paramKey}
                    sourceVariable={sourceVariable}
                    agentNodeId={agentNodeId}
                    agentName={agentName}
                  />
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}

export default memo(SubGraphModal)
