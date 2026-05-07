# Rule Catalog — Code Quality

## Conditional class names use utility function

IsUrgent: True
Category: Code Quality

### Description

Ensure conditional CSS and multi-line class composition are handled via the shared `cn` helper instead of custom ternaries, string concatenation, array `.join(' ')`, or template strings. Centralizing class logic keeps components consistent and easier to maintain.

### Suggested Fix

```ts
import { cn } from '@langgenius/dify-ui/cn'
const classNames = cn(isActive ? 'text-primary-600' : 'text-gray-500')
```

## Tailwind-first styling

IsUrgent: True
Category: Code Quality

### Description

Favor Tailwind CSS utility classes instead of adding new `.module.css` files unless a Tailwind combination cannot achieve the required styling. Keeping styles in Tailwind improves consistency and reduces maintenance overhead.

## CSS files must be scoped

IsUrgent: True
Category: Code Quality

### Description

When CSS is truly necessary, use component-scoped `*.module.css`. Do not add component-level CSS through plain `.css` files, and do not import component CSS from `globals.css`; both patterns risk style leakage across the app.

## Split oversized components cautiously

Category: Code Quality

### Description

When a frontend file grows large or mixes multiple responsibilities, suggest splitting it into focused components, hooks, or utilities. Prefer shallow local structure that matches existing repo patterns, such as a sibling `components/` folder, and avoid deep folder hierarchies unless the surrounding code already uses them.

Update this file when adding, editing, or removing Code Quality rules so the catalog remains accurate.

## Classname ordering for easy overrides

### Description

When writing components, always place the incoming `className` prop after the component’s own class values so that downstream consumers can override or extend the styling. This keeps your component’s defaults but still lets external callers change or remove specific styles.

Example:

```tsx
import { cn } from '@langgenius/dify-ui/cn'

const Button = ({ className }) => {
  return <div className={cn('bg-primary-600', className)}></div>
}
```
