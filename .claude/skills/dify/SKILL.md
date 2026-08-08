```markdown
# dify Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development conventions and workflows used in the `dify` TypeScript codebase. You'll learn about file organization, coding style, commit message patterns, and how to write and run tests. This guide is ideal for contributors looking to maintain consistency and quality in the project.

## Coding Conventions

### File Naming
- **Style:** kebab-case
- **Example:**  
  ```
  user-profile.ts
  data-service.ts
  ```

### Import Style
- **Style:** Relative imports
- **Example:**
  ```typescript
  import { fetchData } from './data-service';
  ```

### Export Style
- **Style:** Named exports
- **Example:**
  ```typescript
  // In data-service.ts
  export function fetchData() { ... }
  ```

### Commit Messages
- **Pattern:** Conventional commits
- **Prefix:** `chore`
- **Average Length:** 64 characters
- **Example:**
  ```
  chore: update dependencies to latest versions
  ```

## Workflows

### Code Contribution
**Trigger:** When adding new features or fixing bugs  
**Command:** `/contribute`

1. Create a new branch from `main`.
2. Write code using kebab-case file names and relative imports.
3. Use named exports for all modules.
4. Write or update corresponding test files (`*.test.*`).
5. Commit changes using the conventional commit format with the appropriate prefix (e.g., `chore:`).
6. Open a pull request for review.

### Commit Message Formatting
**Trigger:** When committing code changes  
**Command:** `/commit-format`

1. Start the commit message with the type prefix (e.g., `chore:`).
2. Write a concise summary (aim for ~64 characters).
3. Example:
   ```
   chore: refactor data-service for improved performance
   ```

## Testing Patterns

- **Test Files:** Named with the pattern `*.test.*` (e.g., `user-profile.test.ts`)
- **Testing Framework:** Not explicitly detected; follow standard TypeScript testing practices.
- **Example Test File:**
  ```typescript
  // user-profile.test.ts
  import { getUserProfile } from './user-profile';

  describe('getUserProfile', () => {
    it('returns user data', () => {
      // test implementation
    });
  });
  ```

## Commands
| Command         | Purpose                                    |
|-----------------|--------------------------------------------|
| /contribute     | Guide for contributing code                |
| /commit-format  | Instructions for writing commit messages   |
```
