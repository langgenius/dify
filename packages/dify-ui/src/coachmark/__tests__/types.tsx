import type {
  CoachmarkChangeEventDetails,
  CoachmarkModal,
  CoachmarkProps,
  CoachmarkSide,
  CoachmarkTarget,
} from '@langgenius/dify-ui/coachmark'
import { Coachmark, CoachmarkPositioner } from '@langgenius/dify-ui/coachmark'
import { expectTypeOf } from 'vite-plus/test'

type Step = { id: 'invite' | 'keys' }

export function coachmarkPayloadTypeContract() {
  const step: Step = { id: 'invite' }
  const maybeStep = step as Step | undefined

  const element = (
    <Coachmark
      open
      target={null}
      payload={step}
      onStepShown={(shown) => expectTypeOf(shown).toEqualTypeOf<Step>()}
    >
      {({ payload }) => {
        expectTypeOf(payload).toEqualTypeOf<Step>()
        return null
      }}
    </Coachmark>
  )

  const nullablePayload = (
    <Coachmark
      open={maybeStep !== undefined}
      target={null}
      payload={maybeStep}
      onStepShown={(shown) => expectTypeOf(shown).toEqualTypeOf<Step>()}
    >
      {({ payload }) => {
        expectTypeOf(payload).toEqualTypeOf<Step>()
        return null
      }}
    </Coachmark>
  )

  const withoutPayload = <Coachmark open target={null} onStepShown={() => {}} />

  const missingPayloadForRender = (
    <Coachmark open target={null}>
      {/* @ts-expect-error Render-function children read the payload, so it must be passed. */}
      {({ payload }: { payload: Step }) => payload.id}
    </Coachmark>
  )

  const missingPayloadForCallback = (
    // @ts-expect-error Without payload, onStepShown cannot declare a payload parameter.
    <Coachmark<Step> open target={null} onStepShown={(shown: Step) => shown.id} />
  )

  return {
    element,
    missingPayloadForCallback,
    missingPayloadForRender,
    nullablePayload,
    withoutPayload,
  }
}

export function coachmarkChangeTypeContract() {
  const onOpenChange: NonNullable<CoachmarkProps['onOpenChange']> = (open, details) => {
    expectTypeOf(open).toEqualTypeOf<boolean>()
    expectTypeOf(details).toEqualTypeOf<CoachmarkChangeEventDetails>()
    expectTypeOf(details.reason).toEqualTypeOf<'close-press' | 'escape-key'>()
  }
  expectTypeOf<CoachmarkModal>().toEqualTypeOf<true | 'allow-target'>()
  expectTypeOf<CoachmarkTarget>().toEqualTypeOf<Element | string | null>()
  // @ts-expect-error The page outside the target stays blocked; a fully non-modal coachmark is not supported.
  const nonModal = <Coachmark open target={null} modal={false} />
  return { nonModal, onOpenChange }
}

export function coachmarkSideTypeContract() {
  expectTypeOf<CoachmarkSide>().toEqualTypeOf<'bottom' | 'inline-end' | 'inline-start' | 'top'>()
  // @ts-expect-error Physical sides do not mirror in right-to-left layouts.
  const physical = <CoachmarkPositioner side="left" />
  // @ts-expect-error Positioner stays fixed to match the viewport spotlight and blocker layers.
  const absolute = <CoachmarkPositioner positionMethod="absolute" />
  return { absolute, physical }
}
