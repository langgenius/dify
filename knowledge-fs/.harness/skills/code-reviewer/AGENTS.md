# Code Review Guidelines

**A comprehensive guide for AI agents performing code reviews**, organized by priority and impact.

---

## Table of Contents

### Security — **CRITICAL**
1. [SQL Injection Prevention](#sql-injection-prevention)
2. [XSS Prevention](#xss-prevention)

### Performance — **HIGH**
3. [Avoid N+1 Query Problem](#avoid-n-1-query-problem)

### Correctness — **HIGH**
4. [Proper Error Handling](#proper-error-handling)

### Maintainability — **MEDIUM**
5. [Use Meaningful Variable Names](#use-meaningful-variable-names)
6. [Add Type Hints](#add-type-hints)

---

## Security

### SQL Injection Prevention

**Impact: CRITICAL** | **Category: security** | **Tags:** sql, security, injection, database

Never construct SQL queries with string concatenation or f-strings. Always use parameterized queries to prevent SQL injection attacks.

#### Why This Matters

SQL injection is one of the most common and dangerous web vulnerabilities. Attackers can:
- Access unauthorized data
- Modify or delete database records
- Execute admin operations on the database
- In some cases, issue commands to the OS

#### ❌ Incorrect

```python
def get_user(user_id):
    query = f"SELECT * FROM users WHERE id = {user_id}"
    result = db.execute(query)
    return result

# Vulnerable to: get_user("1 OR 1=1")
# Returns all users!
```

#### ✅ Correct

```python
def get_user(user_id: int) -> Optional[Dict[str, Any]]:
    query = "SELECT * FROM users WHERE id = ?"
    result = db.execute(query, (user_id,))
    return result.fetchone() if result else None
```

[➡️ Full details: security-sql-injection.md](rules/security-sql-injection.md)

---

### XSS Prevention

**Impact: CRITICAL** | **Category: security** | **Tags:** xss, security, html, javascript

Never insert unsanitized user input into HTML. Always escape output or use frameworks that auto-escape by default.

#### ❌ Incorrect

```javascript
// Dangerous!
document.getElementById('username').innerHTML = userInput;
```

#### ✅ Correct

```javascript
// Safe: use textContent
element.textContent = userInput;

// Or sanitize if HTML needed
import DOMPurify from 'dompurify';
element.innerHTML = DOMPurify.sanitize(userHtml);
```

[➡️ Full details: security-xss-prevention.md](rules/security-xss-prevention.md)

---

## Performance

### Avoid N+1 Query Problem

**Impact: HIGH** | **Category: performance** | **Tags:** database, performance, orm, queries

The N+1 query problem occurs when code executes 1 query to fetch a list, then N additional queries to fetch related data for each item.

#### ❌ Incorrect

```python
# 101 queries for 100 posts!
posts = Post.objects.all()  # 1 query
for post in posts:
    print(f"{post.title} by {post.author.name}")  # N queries
```

#### ✅ Correct

```python
# 1 query with JOIN
posts = Post.objects.select_related('author').all()
for post in posts:
    print(f"{post.title} by {post.author.name}")  # No extra queries!
```

[➡️ Full details: performance-n-plus-one.md](rules/performance-n-plus-one.md)

---

## Correctness

### Proper Error Handling

**Impact: HIGH** | **Category: correctness** | **Tags:** errors, exceptions, reliability

Always handle errors explicitly. Don't use bare except clauses or ignore errors silently.

#### ❌ Incorrect

```python
try:
    result = risky_operation()
except:
    pass  # Silent failure!
```

#### ✅ Correct

```python
try:
    config = json.loads(config_file.read())
except json.JSONDecodeError as e:
    logger.error(f"Invalid JSON in config file: {e}")
    config = get_default_config()
except FileNotFoundError:
    logger.warning("Config file not found, using defaults")
    config = get_default_config()
```

[➡️ Full details: correctness-error-handling.md](rules/correctness-error-handling.md)

---

## Maintainability

### Use Meaningful Variable Names

**Impact: MEDIUM** | **Category: maintainability** | **Tags:** naming, readability, code-quality

Choose descriptive, intention-revealing names. Avoid single letters (except loop counters), abbreviations, and generic names.

#### ❌ Incorrect

```python
def calc(x, y, z):
    tmp = x * y
    res = tmp + z
    return res
```

#### ✅ Correct

```python
def calculate_total_price(item_price: float, quantity: int, tax_rate: float) -> float:
    subtotal = item_price * quantity
    total_with_tax = subtotal + (subtotal * tax_rate)
    return total_with_tax
```

[➡️ Full details: maintainability-naming.md](rules/maintainability-naming.md)

---

### Add Type Hints

**Impact: MEDIUM** | **Category: maintainability** | **Tags:** types, python, typescript, type-safety

Use type annotations to make code self-documenting and catch errors early.

#### ❌ Incorrect

```python
def get_user(id):
    return users.get(id)
```

#### ✅ Correct

```python
def get_user(id: int) -> Optional[Dict[str, Any]]:
    """Fetch user by ID."""
    return users.get(id)
```

[➡️ Full details: maintainability-type-hints.md](rules/maintainability-type-hints.md)

---

## Quick Reference

### Review Checklist

**Security (CRITICAL - review first)**
- [ ] No SQL injection vulnerabilities
- [ ] No XSS vulnerabilities
- [ ] Secrets not hardcoded
- [ ] Authentication/authorization checks present

**Performance (HIGH)**
- [ ] No N+1 queries
- [ ] Appropriate caching
- [ ] No unnecessary database calls
- [ ] Efficient algorithms

**Correctness (HIGH)** - [ ] Proper error handling
- [ ] Edge cases handled
- [ ] Input validation
- [ ] No race conditions

**Maintainability (MEDIUM)**
- [ ] Clear variable/function names
- [ ] Type hints present
- [ ] Code is DRY (Don't Repeat Yourself)
- [ ] Functions are single-purpose

**Testing**
- [ ] Tests cover new code
- [ ] Edge cases tested
- [ ] Error paths tested

---

## Severity Levels

| Level | Description | Examples | Action |
|-------|-------------|----------|--------|
| **CRITICAL** | Security vulnerabilities, data loss risks | SQL injection, XSS, auth bypass | Block merge, fix immediately |
| **HIGH** | Performance issues, correctness bugs | N+1 queries, race conditions | Fix before merge |
| **MEDIUM** | Maintainability, code quality | Naming, type hints, comments | Fix or accept with TODO |
| **LOW** | Style preferences, minor improvements | Formatting, minor refactoring | Optional |

---

## Review Output Format

When performing reviews, structure as:

```markdown
## Security Issues (X found)

### CRITICAL: SQL Injection in `get_user()`
**File:** `api/users.py:45`
**Issue:** User input interpolated directly into SQL query
**Fix:** Use parameterized query

## Performance Issues (X found)

### HIGH: N+1 Query in `list_posts()`
**File:** `views/posts.py:23`
**Issue:** Fetching author in loop
**Fix:** Add `.select_related('author')`

## Summary
- 🔴 CRITICAL: 1
- 🟠 HIGH: 1
- 🟡 MEDIUM: 3
- ⚪ LOW: 2

**Recommendation:** Address CRITICAL and HIGH issues before merging.
```

---

## References

- Individual rule files in `rules/` directory
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Clean Code by Robert Martin](https://www.oreilly.com/library/view/clean-code-a/9780136083238/)
