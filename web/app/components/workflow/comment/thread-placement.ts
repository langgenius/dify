import type { PopoverPositionerProps } from '@langgenius/dify-ui/popover'

/**
 * Where a thread popup sits beside its comment marker in the design: 17px to
 * the right, top raised by a fifth of the popup's height. Spread onto the
 * `PopoverPositioner` that holds `CommentThreadPopup`; collision handling
 * flips it to the left.
 */
export const commentThreadPlacement = {
  side: 'right',
  align: 'start',
  sideOffset: 17,
  alignOffset: ({ positioner }) => -positioner.height / 5,
} satisfies Pick<PopoverPositionerProps, 'side' | 'align' | 'sideOffset' | 'alignOffset'>
