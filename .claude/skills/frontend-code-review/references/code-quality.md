# Rule Catalog — Code Quality

## Conditional class names use utility function

IsUrgent: True
Category: Code Quality

### Description

Ensure conditional CSS is handled via the shared `classNames` instead of custom ternaries, string concatenation, or template strings. Centralizing class logic keeps components consistent and easier to maintain.

### Suggested Fix

```ts
import cn from '@/utils/classnames'
const classNames = cn(isActive ? 'text-primary-600' : 'text-gray-500')
```

## Tailwind-first styling

IsUrgent: True
Category: Code Quality

### Description

Favor Tailwind CSS utility classes instead of adding new `.module.css` files unless a Tailwind combination cannot achieve the required styling. Keeping styles in Tailwind improves consistency and reduces maintenance overhead.

Update this file when adding, editing, or removing Code Quality rules so the catalog remains accurate.

### Classname ordering for easy overrides

## Classname ordering for easy overrides

### Description

When writing components, always place the incoming `className` prop after the component’s own class values so that downstream consumers can override or extend the styling. This keeps your component’s defaults but still lets external callers change or remove specific styles.

Example:

```tsx
import cn from '@/utils/classnames'

const Button = ({ className }) => {
  return <div className={cn('bg-primary-600', className)}></div>
}

<Button className="bg-white" /> // renders with `className="bg-white"`
```

If you accidentally emit `<div className={cn(className, 'bg-primary-600')}>`, external styles would be layered underneath, making it harder to override defaults cleanly.
