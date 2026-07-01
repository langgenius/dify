import type { SlashCommandHandler } from './types'
import type { WorkflowGeneratorMode } from '@/app/components/workflow/workflow-generator/types'
import { RiChat3Line, RiNodeTree, RiSparkling2Line } from '@remixicon/react'
import * as React from 'react'
import { getI18n } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useWorkflowGeneratorStore } from '@/app/components/workflow/workflow-generator/store'
import { AppModeEnum } from '@/types/app'
import { registerCommands, unregisterCommands } from './command-bus'

type CreateOption = {
  id: string
  /** i18n key (ns: 'app') for the option's display label. */
  titleKey: string
  /** i18n key (ns: 'app') for the option's one-line description. */
  descKey: string
  /** Provisional concrete mode for suggestions/preview; `auto` resolves the real one server-side. */
  mode: WorkflowGeneratorMode
  /** When set, the modal opens in auto-mode and the planner picks the app type. */
  auto?: boolean
  icon: React.ComponentType<{ className?: string }>
}

// `as const` keeps titleKey/descKey as literal types so the typed `i18n.t`
// accepts them as known keys; `satisfies` still validates the shape.
const OPTIONS = [
  {
    id: 'auto',
    titleKey: 'gotoAnything.actions.createAuto',
    descKey: 'gotoAnything.actions.createAutoDesc',
    mode: 'advanced-chat',
    auto: true,
    icon: RiSparkling2Line,
  },
  {
    id: 'workflow',
    titleKey: 'gotoAnything.actions.createWorkflow',
    descKey: 'gotoAnything.actions.createWorkflowDesc',
    mode: 'workflow',
    auto: false,
    icon: RiNodeTree,
  },
  {
    id: 'chatflow',
    titleKey: 'gotoAnything.actions.createChatflow',
    descKey: 'gotoAnything.actions.createChatflowDesc',
    mode: 'advanced-chat',
    auto: false,
    icon: RiChat3Line,
  },
] as const satisfies readonly CreateOption[]

/**
 * `/create` command — generate a Workflow or Chatflow app from a
 * natural-language description.
 *
 * The user-picked mode is passed through to the generator modal explicitly
 * rather than sniffed from the URL, which avoids the mode-mismatch dead-end
 * the URL-sniffing approach used to produce. An `Auto` option lets the planner
 * pick the app type from the description.
 *
 * Inline capture: a multi-word query threads the trailing text into the modal as
 * a pre-filled instruction (e.g. `/create workflow summarize a URL`, or
 * `/create translate this` to pre-fill while still picking the type).
 *
 * When triggered from inside a graph-based Studio (Workflow / Advanced-Chat)
 * whose app mode matches the picked mode, it threads the current app (id + mode)
 * through so the modal offers "Apply to current draft". Auto-mode always creates
 * a new app since the planner may pick a different type than the open Studio.
 */
export const createCommand: SlashCommandHandler = {
  name: 'create',
  aliases: ['new', 'generate'],
  // Fallback only — the palette localises the root row via the slashKeyMap in
  // command-selector.tsx (gotoAnything.actions.createCategoryDesc).
  description: 'Create an AI-generated workflow or chatflow',
  mode: 'submenu',

  async search(args: string, locale?: string) {
    const i18n = getI18n()
    const tr = (key: (typeof OPTIONS)[number]['titleKey' | 'descKey']) =>
      i18n.t(key, { ns: 'app', lng: locale })

    const renderIcon = (Icon: CreateOption['icon']) => (
      <div className="flex h-6 w-6 items-center justify-center rounded-md border-[0.5px] border-divider-regular bg-components-panel-bg">
        <Icon className="size-4 text-text-tertiary" />
      </div>
    )

    const toResult = (opt: (typeof OPTIONS)[number], instruction: string) => ({
      id: `create-${opt.id}`,
      title: tr(opt.titleKey),
      // Surface the captured instruction so the user sees it was picked up; fall
      // back to the option's static description otherwise.
      description: instruction || tr(opt.descKey),
      type: 'command' as const,
      icon: renderIcon(opt.icon),
      data: { command: 'create.open', args: { mode: opt.mode, auto: !!opt.auto, instruction } },
    })

    const trimmed = args.trim()
    const tokens = trimmed ? trimmed.split(/\s+/) : []

    // Single token (or empty): narrow the option list by name — the original
    // submenu-filter behaviour, no instruction captured.
    if (tokens.length <= 1) {
      const query = trimmed.toLowerCase()
      return OPTIONS
        .filter(opt => !query || opt.id.includes(query) || tr(opt.titleKey).toLowerCase().includes(query))
        .map(opt => toResult(opt, ''))
    }

    // Multi-token: inline capture. If the first word names a mode, use it and
    // treat the rest as the instruction; otherwise keep every option with the
    // full text as the instruction so the user just picks the type.
    const first = tokens[0]!.toLowerCase()
    const matched = OPTIONS.find(opt => opt.id === first || tr(opt.titleKey).toLowerCase() === first)
    if (matched)
      return [toResult(matched, tokens.slice(1).join(' '))]
    return OPTIONS.map(opt => toResult(opt, trimmed))
  },

  register() {
    registerCommands({
      'create.open': async (args) => {
        const mode: WorkflowGeneratorMode = (args?.mode ?? 'workflow') as WorkflowGeneratorMode
        const autoMode = !!args?.auto
        const initialInstruction = typeof args?.instruction === 'string' ? args.instruction : ''

        // If a graph-based Studio app is open and its mode matches the picked
        // mode, thread it through so the modal can offer "Apply to current
        // draft". A mode mismatch (or no app open) falls back to new-app only,
        // mirroring the precondition the modal uses for canApplyToCurrent.
        // Auto-mode always creates a new app — the planner may resolve a type
        // different from the open Studio, so applying to the current draft is
        // unsafe.
        const appDetail = useAppStore.getState().appDetail
        const currentAppMode: WorkflowGeneratorMode | null
          = appDetail?.mode === AppModeEnum.WORKFLOW
            ? 'workflow'
            : appDetail?.mode === AppModeEnum.ADVANCED_CHAT
              ? 'advanced-chat'
              : null

        if (!autoMode && appDetail && currentAppMode === mode) {
          useWorkflowGeneratorStore.getState().openGenerator({
            mode,
            currentAppId: appDetail.id,
            currentAppMode,
            initialInstruction,
          })
          return
        }

        useWorkflowGeneratorStore.getState().openGenerator({ mode, autoMode, initialInstruction })
      },
    })
  },

  unregister() {
    unregisterCommands(['create.open'])
  },
}
