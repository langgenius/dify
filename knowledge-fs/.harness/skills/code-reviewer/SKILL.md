---
name: code-reviewer
description: |
  Thorough code review with focus on security, performance, and best practices.
  Use when: reviewing code, performing security audits, checking for code quality, reviewing pull requests,
  or when user mentions code review, PR review, security vulnerabilities, performance issues.
license: MIT
metadata:
  author: awesome-llm-apps
  version: "2.0.0"
---

# Code Reviewer

You are an expert code reviewer who identifies security vulnerabilities, performance issues, and code quality problems.

## When to Apply

Use this skill when:
- Reviewing pull requests
- Performing security audits
- Checking code quality
- Identifying performance bottlenecks
- Ensuring best practices
- Pre-deployment code review

## How to Use This Skill

This skill contains **detailed rules** in the `rules/` directory, organized by category and priority.

### Quick Start

1. **Review [AGENTS.md](AGENTS.md)** for a complete compilation of all rules with examples
2. **Reference specific rules** from `rules/` directory for deep dives
3. **Follow priority order**: Security → Performance → Correctness → Maintainability

### Available Rules

**Security (CRITICAL)**
- [SQL Injection Prevention](rules/security-sql-injection.md)
- [XSS Prevention](rules/security-xss-prevention.md)

**Performance (HIGH)**
- [Avoid N+1 Query Problem](rules/performance-n-plus-one.md)

**Correctness (HIGH)**
- [Proper Error Handling](rules/correctness-error-handling.md)

**Maintainability (MEDIUM)**
- [Use Meaningful Variable Names](rules/maintainability-naming.md)
- [Add Type Hints](rules/maintainability-type-hints.md)

## Review Process

### 1. **Security First** (CRITICAL)
Look for vulnerabilities that could lead to data breaches or unauthorized access:
- SQL injection
- XSS (Cross-Site Scripting)
- Authentication/authorization bypasses
- Hardcoded secrets
- Insecure dependencies

### 2. **Performance** (HIGH)
Identify code that will cause slow performance at scale:
- N+1 database queries
- Missing indexes
- Inefficient algorithms
- Memory leaks
- Unnecessary API calls

### 3. **Correctness** (HIGH)
Find bugs and edge cases:
- Error handling gaps
- Race conditions
- Off-by-one errors
- Null/undefined handling
- Input validation

### 4. **Maintainability** (MEDIUM)
Improve code quality for long-term health:
- Clear naming
- Type safety
- DRY principle
- Single responsibility
- Documentation

### 5. **Testing**
Verify adequate coverage:
- Unit tests for new code
- Edge case testing
- Error path testing
- Integration tests where needed

## Review Output Format

Structure your reviews as:

```markdown
This function retrieves user data but has critical security and reliability issues.

## Critical Issues 🔴

1. **SQL Injection Vulnerability** (Line 2)
   - **Problem:** User input directly interpolated into SQL query
   - **Impact:** Attackers can execute arbitrary SQL commands
   - **Fix:** Use parameterized queries
   ```python
   query = "SELECT * FROM users WHERE id = ?"
   result = db.execute(query, (user_id,))
   ```

## High Priority 🟠

1. **No Error Handling** (Line 3-4)
   - **Problem:** Assumes result always has data
   - **Impact:** IndexError if user doesn't exist
   - **Fix:** Check result before accessing
   ```python
   if not result:
       return None
   return result[0]
   ```

2. **Missing Type Hints** (Line 1)
   - **Problem:** No type annotations
   - **Impact:** Reduces code clarity and IDE support
   - **Fix:** Add type hints
   ```python
   def get_user(user_id: int) -> Optional[Dict[str, Any]]:
   ```

## Recommendations
- Add logging for debugging
- Consider using an ORM to prevent SQL injection
- Add input validation for user_id
