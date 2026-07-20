---
title: Use Meaningful Variable Names
impact: MEDIUM
category: maintainability
tags: naming, readability, code-quality
---

# Use Meaningful Variable Names

Choose descriptive, intention-revealing names. Avoid single letters (except loop counters), abbreviations, and generic names.

## Why This Matters

Code is read 10x more than it's written. Clear names:
- Make code self-documenting
- Reduce cognitive load
- Prevent bugs from misunderstanding
- Enable easier refactoring

## ❌ Incorrect

```python
# ❌ Cryptic, meaningless
def calc(x, y, z):
    tmp = x * y
    res = tmp + z
    return res

# ❌ Too generic
data = fetch_data()
result = process(data)
output = format(result)

# ❌ Confusing abbreviations
usr_nm = input()
acc_bal = get_bal(usr_nm)
```

## ✅ Correct

```python
# ✅ Clear, descriptive
def calculate_total_price(item_price: float, quantity: int, tax_rate: float) -> float:
    """Calculate total price including tax."""
    subtotal = item_price * quantity
    total_with_tax = subtotal + (subtotal * tax_rate)
    return total_with_tax

# ✅ Intention-revealing
customer_orders = fetch_customer_orders(customer_id)
validated_orders = validate_orders(customer_orders)
order_confirmation_email = format_confirmation_email(validated_orders)

# ✅ Full words
username = input("Enter username: ")
account_balance = get_account_balance(username)
```

## Naming Conventions by Language

### Python (PEP 8)
```python
# Variables & functions: snake_case
user_count = 10
def calculate_average(): pass

# Classes: PascalCase
class UserAccount: pass

# Constants: UPPER_SNAKE_CASE
MAX_RETRY_ATTEMPTS = 3
```

### JavaScript/TypeScript
```javascript
// Variables & functions: camelCase
const userCount = 10;
function calculateAverage() {}

// Classes: PascalCase
class UserAccount {}

// Constants: UPPER_SNAKE_CASE or camelCase
const MAX_RETRY_ATTEMPTS = 3;
const maxRetryAttempts = 3;  // Also acceptable
```

### Booleans
```python
# Use is_, has_, can_ prefixes
is_active = True
has_permission = check_permission()
can_edit = user.role == "admin"

# Not: active, permission, editable
```

## Context Matters

### Loop Variables
```python
# ❌ Generic in complex loop
for i in users:
    for j in i.orders:
        process(j)

# ✅ Descriptive
for user in users:
    for order in user.orders:
        process_order(order)

# ✅ Single letter OK for simple index
for i in range(10):
    print(i)
```

### Scope-Appropriate Names
```python
# Short scope: concise OK
def validate(email):
    # 'email' is clear in this small function
    return '@' in email and '.' in email

# Long scope: more descriptive
class UserAuthenticationService:
    def __init__(self):
        # Longer, clearer for class-level
        self.failed_login_attempts = {}
        self.account_lockout_duration_seconds = 300
```

## Avoid Ambiguity

```python
# ❌ Ambiguous
def get_data(id):
    return data[id]

# What data? What ID?

# ✅ Specific
def get_user_by_id(user_id: int) -> User:
    return users_cache[user_id]
```

## References

- [PEP 8 - Python Naming Conventions](https://peps.python.org/pep-0008/#naming-conventions)
- [Clean Code by Robert Martin](https://www.amazon.com/Clean-Code-Handbook-Software-Craftsmanship/dp/0132350882)
