---
title: Add Type Hints
impact: MEDIUM
category: maintainability
tags: types, python, typescript, type-safety
---

# Add Type Hints

Use type annotations to make code self-documenting and catch errors early.

## Why This Matters

Type hints provide:
- **Static analysis** - catch bugs before runtime
- **Better IDE support** - autocomplete, refactoring
- **Documentation** - types explain intent
- **Confidence** - easier refactoring

##❌ Incorrect

```python
# ❌ No type hints
def get_user(id):
    return users.get(id)

def process_order(order, discount):
    if discount:
        return order['total'] * (1 - discount)
    return order['total']
```

## ✅ Correct

```python
# ✅ Full type hints
from typing import Optional, Dict, Any

def get_user(id: int) -> Optional[Dict[str, Any]]:
    """Fetch user by ID.
    
    Args:
        id: User ID
        
    Returns:
        User dict or None if not found
    """
    return users.get(id)

def process_order(order: Dict[str, Any], discount: Optional[float] = None) -> float:
    """Calculate order total with optional discount.
    
    Args:
        order: Order dictionary with 'total' key
        discount: Discount rate (0.0-1.0), e.g. 0.1 for 10% off
        
    Returns:
        Final price after discount
    """
    if discount:
        return order['total'] * (1 - discount)
    return order['total']
```

## TypeScript

```typescript
// ✅ Explicit types
interface User {
  id: number;
  name: string;
  email: string;
}

function getUser(id: number): User | null {
  return users.get(id) ?? null;
}

function processOrder(
  order: { total: number },
  discount?: number
): number {
  if (discount) {
    return order.total * (1 - discount);
  }
  return order.total;
}
```

## References

- [Python Type Hints](https://docs.python.org/3/library/typing.html)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
