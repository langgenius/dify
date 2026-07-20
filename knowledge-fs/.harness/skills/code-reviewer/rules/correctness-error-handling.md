---
title: Proper Error Handling
impact: HIGH
category: correctness
tags: errors, exceptions, reliability
---

# Proper Error Handling

Always handle errors explicitly. Don't use bare except clauses or ignore errors silently. Provide helpful error messages.

## Why This Matters

Proper error handling:
- Prevents silent failures
- Aids debugging with clear messages
- Allows graceful degradation
- Improves user experience
- Enables error monitoring/alerting

## ❌ Incorrect

### Bare Except Clause
```python
# ❌ Catches everything, including KeyboardInterrupt, SystemExit
try:
    result = risky_operation()
except:
    pass  # Silent failure, no idea what went wrong
```

### Generic Exception Without Context
```python
# ❌ Too generic, loses error information
try:
    data = fetch_user(user_id)
    process(data)
    save_result()
except Exception:
    print("Error occurred")  # Which operation failed? Why?
```

### Ignoring Specific Errors
```python
# ❌ Ignoring errors entirely
try:
    config = json.loads(config_file.read())
except json.JSONDecodeError:
    pass  # App continues with undefined 'config'
```

## ✅ Correct

### Catch Specific Exceptions
```python
# ✅ Handle specific errors appropriately
try:
    config = json.loads(config_file.read())
except json.JSONDecodeError as e:
    logger.error(f"Invalid JSON in config file: {e}")
    # Provide sensible default
    config = get_default_config()
except FileNotFoundError:
    logger.warning("Config file not found, using defaults")
    config = get_default_config()
```

### Provide Context in Error Messages
```python
# ✅ Clear, actionable error messages
def  get_user(user_id: int) -> User:
    try:
        response = requests.get(f"{API_URL}/users/{user_id}", timeout=5)
        response.raise_for_status()
        return User(**response.json())
    except requests.Timeout:
        raise ValueError(
            f"Timeout fetching user {user_id} from {API_URL}. "
            "Check network connection or increase timeout."
        )
    except requests.HTTPError as e:
        if e.response.status_code == 404:
            raise UserNotFoundError(f"User {user_id} does not exist")
        raise ValueError(f"HTTP error fetching user {user_id}: {e}")
    except json.JSONDecodeError:
        raise ValueError(f"Invalid JSON response for user {user_id}")
```

### Re-raise with Context
```python
# ✅ Add context while preserving stack trace
try:
    process_batch(items)
except ValidationError as e:
    # Add context and re-raise
    raise ValidationError(
        f"Batch processing failed for {len(items)} items: {e}"
    ) from e
```

## JavaScript/TypeScript

### ❌ Catching Without Specificity
```javascript
// ❌ No error handling
async function fetchUser(id) {
  const response = await fetch(`/api/users/${id}`);
  return response.json();  // What if fetch fails? What if not JSON?
}

// ❌ Generic catch
try {
  const user = await fetchUser(id);
} catch (error) {
  console.log('Error');  // Which error? From where?
}
```

### ✅ Explicit Error Handling
```typescript
// ✅ Proper error handling with types
class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`User ${userId} not found`);
    this.name = 'UserNotFoundError';
  }
}

async function fetchUser(id: string): Promise<User> {
  let response: Response;
  
  try {
    response = await fetch(`/api/users/${id}`, {
      signal: AbortSignal.timeout(5000)
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(`Timeout fetching user ${id}`);
    }
    throw new Error(`Network error fetching user ${id}: ${error}`);
  }
  
  if (!response.ok) {
    if (response.status === 404) {
      throw new UserNotFoundError(id);
    }
    throw new Error(`HTTP ${response.status} fetching user ${id}`);
  }
  
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`Invalid JSON response for user ${id}`);
  }
}

// Usage
try {
  const user = await fetchUser(userId);
  displayUser(user);
} catch (error) {
  if (error instanceof UserNotFoundError) {
    showNotFoundMessage();
  } else {
    logger.error('Failed to load user:', error);
    showErrorMessage('Unable to load user. Please try again.');
  }
}
```

## Error Handling Patterns

### Result Type (Rust-inspired)
```typescript
type Result<T, E = Error> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

function parseConfig(json: string): Result<Config> {
  try {
    const config = JSON.parse(json);
    return { ok: true, value: config };
  } catch (error) {
    return { ok: false, error: new Error(`Invalid config: ${error}`) };
  }
}

// Usage
const result = parseConfig(configString);
if (result.ok) {
  useConfig(result.value);
} else {
  logger.error(result.error);
  useDefaultConfig();
}
```

### Custom Error Classes
```python
class DatabaseError(Exception):
    """Base class for database errors."""
    pass

class ConnectionError(DatabaseError):
    """Database connection failed."""
    pass

class QueryError(DatabaseError):
    """Query execution failed."""
    def __init__(self, query: str, original_error: Exception):
        self.query = query
        self.original_error = original_error
        super().__init__(f"Query failed: {query[:100]}... Error: {original_error}")

# Usage
try:
    db.execute(query)
except psycopg2.OperationalError as e:
    raise ConnectionError(f"Cannot connect to database: {e}") from e
except psycopg2.Error as e:
    raise QueryError(query, e) from e
```

## Logging Errors

```python
import logging

logger = logging.getLogger(__name__)

try:
    result = complex_operation()
except ValueError as e:
    logger.error(
        "Operation failed",
        exc_info=True,  # Include stack trace
        extra={
            'user_id': user_id,
            'operation': 'complex_operation',
            'input_data': sanitized_data
        }
    )
    raise
```

## Best Practices

- [ ] **Catch specific exceptions** (not bare `except` or generic `Exception`)
- [ ] **Provide context** in error messages (what failed, why, how to fix)
- [ ] **Log errors** with relevant details
- [ ] **Don't silently ignore errors**
- [ ] **Use custom exception classes** for domain errors
- [ ] **Include stack traces** in logs (but not user-facing messages)
- [ ] **Handle errors at appropriate level** (don't catch too early)
- [ ] **Clean up resources** (use context managers/try-finally)

## Monitoring & Alerting

```python
# Integration with error tracking
import sentry_sdk

try:
    process_payment(order)
except PaymentError as e:
    sentry_sdk.capture_exception(e)
    sentry_sdk.set_context("order", {
        "order_id": order.id,
        "amount": order.total,
        "user_id": order.user_id
    })
    raise
```

## References

- [Python Exception Handling Best Practices](https://docs.python.org/3/tutorial/errors.html)
- [Error Handling in JavaScript](https://javascript.info/try-catch)
- [Sentry Error Monitoring](https://sentry.io/)
