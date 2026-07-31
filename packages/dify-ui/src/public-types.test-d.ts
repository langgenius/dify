// Compile-time public API contracts; included by package typecheck and excluded from package exports.
import type {
  AutocompleteCollection,
  AutocompleteCollectionProps,
  AutocompleteGroup,
  AutocompleteGroupProps,
  AutocompleteItemProps,
  AutocompleteList,
  AutocompleteListProps,
  AutocompleteProps,
} from './autocomplete'
import type {
  ComboboxCollection,
  ComboboxCollectionProps,
  ComboboxGroup,
  ComboboxGroupProps,
  ComboboxItemProps,
  ComboboxList,
  ComboboxListProps,
  ComboboxProps,
  ComboboxValue,
  ComboboxValueProps,
} from './combobox'
import type { ContextMenuRadioGroupProps, ContextMenuRadioItemProps } from './context-menu'
import type { DialogHandle, DialogTriggerProps } from './dialog'
import type { DrawerHandle, DrawerTriggerProps } from './drawer'
import type { DropdownMenuRadioGroupProps, DropdownMenuRadioItemProps } from './dropdown-menu'
import type { FormProps } from './form'
import type { PopoverHandle, PopoverTriggerProps } from './popover'
import type { PreviewCardHandle, PreviewCardTriggerProps } from './preview-card'
import type { RadioGroupProps, RadioItemProps } from './radio'
import type { SelectItemProps, SelectProps, SelectValue, SelectValueProps } from './select'
import type { SliderRootProps } from './slider'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Expect<Condition extends true> = Condition
type Arguments<Callback> = Callback extends (...args: infer Values) => unknown ? Values : never
type FirstArgument<Callback> = Arguments<Callback>[0]
type SecondArgument<Callback> = Arguments<Callback>[1]
type IsRequired<Props, Key extends keyof Props> =
  Record<never, never> extends Pick<Props, Key> ? false : true
type Callable<Member> = Member extends (...args: infer Values) => infer Result
  ? (...args: Values) => Result
  : never

type DomainValue = { id: string }
type FormValues = { enabled: boolean; name: string }
type RangeValue = readonly [number, number]
type OverlayPayload = { sourceId: string }
type SelectSingleValueProps = Parameters<typeof SelectValue<DomainValue>>[0]
type SelectMultipleValueProps = Parameters<typeof SelectValue<DomainValue, true>>[0]
type SelectDynamicValueProps = Parameters<typeof SelectValue<DomainValue, boolean>>[0]
type ComboboxSingleValueProps = Parameters<typeof ComboboxValue<DomainValue>>[0]
type ComboboxMultipleValueProps = Parameters<typeof ComboboxValue<DomainValue, true>>[0]
type ComboboxDynamicValueProps = Parameters<typeof ComboboxValue<DomainValue, boolean>>[0]
type AutocompleteListRuntimeProps = Parameters<typeof AutocompleteList<DomainValue>>[0]
type AutocompleteCollectionRuntimeProps = Parameters<typeof AutocompleteCollection<DomainValue>>[0]
type AutocompleteGroupRuntimeProps = Parameters<typeof AutocompleteGroup<DomainValue>>[0]
type ComboboxListRuntimeProps = Parameters<typeof ComboboxList<DomainValue>>[0]
type ComboboxCollectionRuntimeProps = Parameters<typeof ComboboxCollection<DomainValue>>[0]
type ComboboxGroupRuntimeProps = Parameters<typeof ComboboxGroup<DomainValue>>[0]

type PublicTypeAssertions = [
  Expect<Equal<FirstArgument<NonNullable<FormProps<FormValues>['onFormSubmit']>>, FormValues>>,
  Expect<
    Equal<
      FirstArgument<NonNullable<SelectProps<DomainValue, false>['onValueChange']>>,
      DomainValue | null
    >
  >,
  Expect<
    Equal<
      FirstArgument<NonNullable<SelectProps<DomainValue, true>['onValueChange']>>,
      DomainValue[]
    >
  >,
  Expect<Equal<IsRequired<SelectProps<DomainValue, true>, 'multiple'>, true>>,
  Expect<Equal<IsRequired<SelectProps<DomainValue, boolean>, 'multiple'>, false>>,
  Expect<Equal<SelectItemProps<DomainValue>['value'], DomainValue | undefined>>,
  Expect<
    Equal<
      FirstArgument<Callable<SelectValueProps<DomainValue, true>['children']>>,
      DomainValue[] | null
    >
  >,
  Expect<Equal<FirstArgument<Callable<SelectSingleValueProps['children']>>, DomainValue | null>>,
  Expect<
    Equal<FirstArgument<Callable<SelectMultipleValueProps['children']>>, DomainValue[] | null>
  >,
  Expect<
    Equal<
      FirstArgument<Callable<SelectDynamicValueProps['children']>>,
      DomainValue | DomainValue[] | null
    >
  >,
  Expect<
    Equal<
      FirstArgument<NonNullable<ComboboxProps<DomainValue, true>['onValueChange']>>,
      DomainValue[]
    >
  >,
  Expect<Equal<IsRequired<ComboboxProps<DomainValue, true>, 'multiple'>, true>>,
  Expect<Equal<IsRequired<ComboboxProps<DomainValue, boolean>, 'multiple'>, false>>,
  Expect<Equal<ComboboxItemProps<DomainValue>['value'], DomainValue | undefined>>,
  Expect<
    Equal<
      FirstArgument<Callable<ComboboxValueProps<DomainValue, true>['children']>>,
      DomainValue[] | null
    >
  >,
  Expect<Equal<FirstArgument<Callable<ComboboxSingleValueProps['children']>>, DomainValue | null>>,
  Expect<
    Equal<FirstArgument<Callable<ComboboxMultipleValueProps['children']>>, DomainValue[] | null>
  >,
  Expect<
    Equal<
      FirstArgument<Callable<ComboboxDynamicValueProps['children']>>,
      DomainValue | DomainValue[] | null
    >
  >,
  Expect<
    Equal<
      FirstArgument<NonNullable<AutocompleteProps<DomainValue>['onItemHighlighted']>>,
      DomainValue | undefined
    >
  >,
  Expect<Equal<AutocompleteItemProps<DomainValue>['value'], DomainValue | undefined>>,
  Expect<
    Equal<FirstArgument<Callable<AutocompleteListProps<DomainValue>['children']>>, DomainValue>
  >,
  Expect<Equal<SecondArgument<Callable<AutocompleteListProps<DomainValue>['children']>>, number>>,
  Expect<Equal<FirstArgument<Callable<AutocompleteListRuntimeProps['children']>>, DomainValue>>,
  Expect<Equal<FirstArgument<AutocompleteCollectionProps<DomainValue>['children']>, DomainValue>>,
  Expect<Equal<SecondArgument<AutocompleteCollectionProps<DomainValue>['children']>, number>>,
  Expect<Equal<FirstArgument<AutocompleteCollectionRuntimeProps['children']>, DomainValue>>,
  Expect<Equal<AutocompleteGroupProps<DomainValue>['items'], readonly DomainValue[] | undefined>>,
  Expect<Equal<AutocompleteGroupRuntimeProps['items'], readonly DomainValue[] | undefined>>,
  Expect<Equal<FirstArgument<Callable<ComboboxListProps<DomainValue>['children']>>, DomainValue>>,
  Expect<Equal<SecondArgument<Callable<ComboboxListProps<DomainValue>['children']>>, number>>,
  Expect<Equal<FirstArgument<Callable<ComboboxListRuntimeProps['children']>>, DomainValue>>,
  Expect<Equal<FirstArgument<ComboboxCollectionProps<DomainValue>['children']>, DomainValue>>,
  Expect<Equal<SecondArgument<ComboboxCollectionProps<DomainValue>['children']>, number>>,
  Expect<Equal<FirstArgument<ComboboxCollectionRuntimeProps['children']>, DomainValue>>,
  Expect<Equal<ComboboxGroupProps<DomainValue>['items'], readonly DomainValue[] | undefined>>,
  Expect<Equal<ComboboxGroupRuntimeProps['items'], readonly DomainValue[] | undefined>>,
  Expect<
    Equal<
      FirstArgument<NonNullable<ContextMenuRadioGroupProps<DomainValue>['onValueChange']>>,
      DomainValue
    >
  >,
  Expect<Equal<ContextMenuRadioItemProps<DomainValue>['value'], DomainValue>>,
  Expect<
    Equal<
      FirstArgument<NonNullable<DropdownMenuRadioGroupProps<DomainValue>['onValueChange']>>,
      DomainValue
    >
  >,
  Expect<Equal<DropdownMenuRadioItemProps<DomainValue>['value'], DomainValue>>,
  Expect<
    Equal<FirstArgument<NonNullable<RadioGroupProps<DomainValue>['onValueChange']>>, DomainValue>
  >,
  Expect<Equal<RadioItemProps<DomainValue>['value'], DomainValue>>,
  Expect<Equal<SliderRootProps<RangeValue>['value'], RangeValue | undefined>>,
  Expect<
    Equal<FirstArgument<NonNullable<SliderRootProps<RangeValue>['onValueChange']>>, RangeValue>
  >,
  Expect<
    Equal<NonNullable<DialogTriggerProps<OverlayPayload>['handle']>, DialogHandle<OverlayPayload>>
  >,
  Expect<
    Equal<NonNullable<DrawerTriggerProps<OverlayPayload>['handle']>, DrawerHandle<OverlayPayload>>
  >,
  Expect<
    Equal<NonNullable<PopoverTriggerProps<OverlayPayload>['handle']>, PopoverHandle<OverlayPayload>>
  >,
  Expect<
    Equal<
      NonNullable<PreviewCardTriggerProps<OverlayPayload>['handle']>,
      PreviewCardHandle<OverlayPayload>
    >
  >,
]

export type { PublicTypeAssertions }
