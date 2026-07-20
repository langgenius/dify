---
title: Avoid N+1 Query Problem
impact: HIGH
category: performance
tags: database, performance, orm, queries
---

# Avoid N+1 Query Problem

The N+1 query problem occurs when code executes 1 query to fetch a list, then N additional queries to fetch related data for each item. This causes severe performance degradation.

## Why This Matters

N+1 queries are one of the most common performance problems:
- **10 items** → 11 queries (1 + 10)
- **100 items** → 101 queries (1 + 100)
- **1000 items** → 1001 queries (1 + 1000)

Each query has network latency (~1-50ms), so 1000 queries = 1-50 seconds of waiting!

## ❌ Incorrect

**Problem:** Fetching related data inside a loop.

### Python (Django ORM)
```python
# ❌ N+1 queries
def get_posts_with_authors():
    posts = Post.objects.all()  # 1 query: SELECT * FROM posts
    
    for post in posts:
        # N queries (one per post): SELECT * FROM users WHERE id = ?
        print(f"{post.title} by {post.author.name}")
    
    return posts

# With 100 posts: 101 database queries!
```

### JavaScript (Sequelize)
```javascript
// ❌ N+1 queries
async function getPostsWithAuthors() {
  const posts = await Post.findAll();  // 1 query
  
  for (const post of posts) {
    // N queries
    const author = await User.findByPk(post.authorId);
    console.log(`${post.title} by ${author.name}`);
  }
}
```

### GraphQL (Common Mistake)
```javascript
// ❌ N+1 queries in resolvers
const resolvers = {
  Query: {
    posts: () => db.posts.findAll()  // 1 query
  },
  Post: {
    // Runs for EACH post!
    author: (post) => db.users.findById(post.authorId)  // N queries
  }
};
```

## ✅ Correct

### Solution 1: Eager Loading / Join Fetching

**Python (Django)**
```python
# ✅ 1 query with JOIN
def get_posts_with_authors():
    posts = Post.objects.select_related('author').all()
    # Single query: SELECT * FROM posts JOIN users ON posts.author_id = users.id
    
    for post in posts:
        print(f"{post.title} by {post.author.name}")  # No extra query!
    
    return posts
```

**Python (SQLAlchemy)**
```python
# ✅ 1 query with JOIN
from sqlalchemy.orm import joinedload

posts = session.query(Post).options(joinedload(Post.author)).all()
```

**JavaScript (Sequelize)**
```javascript
// ✅ 1 query with JOIN
const posts = await Post.findAll({
  include: [{
    model: User,
    as: 'author'
  }]
});

posts.forEach(post => {
  console.log(`${post.title} by ${post.author.name}`);  // No extra query!
});
```

**JavaScript (Prisma)**
```javascript
// ✅ 1 query with JOIN
const posts = await prisma.post.findMany({
  include: {
    author: true
  }
});
```

### Solution 2: Batching / DataLoader (for GraphQL)

```javascript
// ✅ Using DataLoader to batch queries
const DataLoader = require('dataloader');

const userLoader = new DataLoader(async (userIds) => {
  // Called once with all user IDs: [1, 2, 3, 4, ...]
  const users = await db.users.findAll({
    where: { id: { in: userIds } }
  });
  
  // Return in same order as requested
  return userIds.map(id => users.find(u => u.id === id));
});

const resolvers = {
  Post: {
    author: (post) => userLoader.load(post.authorId)  // Batched!
  }
};

// 100 posts → 2 queries (1 for posts, 1 batched for all authors)
```

### Solution 3: Prefetch IDs, Then Batch

```python
# ✅ Fetch all at once
def get_posts_with_authors():
    posts = Post.objects.all()
    
    # Get all unique author IDs
    author_ids = {post.author_id for post in posts}
    
    # Single query for all authors
    authors = User.objects.filter(id__in=author_ids)
    author_map = {author.id: author for author in authors}
    
    # Attach authors to posts
    for post in posts:
        post.author = author_map[post.author_id]
    
    return posts

# 2 queries total (much better than N+1)
```

## Many-to-Many Relationships

**❌ N+1 with many-to-many**
```python
# ❌ Bad
posts = Post.objects.all()
for post in posts:
    tags = post.tags.all()  # N queries!
```

**✅ Prefetch many-to-many**
```python
# ✅ Good
posts = Post.objects.prefetch_related('tags').all()
for post in posts:
    tags = post.tags.all()  # No extra queries!

# Uses 2 queries:
# 1. SELECT * FROM posts
# 2. SELECT * FROM tags WHERE post_id IN (1,2,3,...)
```

## Detecting N+1 Queries

### Django Debug Toolbar
```python
# settings.py
INSTALLED_APPS = ['debug_toolbar', ...]

# Shows exact queries executed
# Highlights duplicate queries
```

### Query Logging
```python
# Python: log all queries
import logging
logging.basicConfig()
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)
```

```javascript
// Sequelize: log queries
const sequelize = new Sequelize({
  logging: console.log  // or custom logger
});
```

### Profiling Tools
- **Django**: django-silk, django-debug-toolbar
- **Rails**: bullet gem
- **Node.js**: Sequelize logging, Prisma debug mode
- **GraphQL**: graphql-query-complexity

## Performance Comparison

```
Test: Fetch 100 posts with authors

N+1 Queries (101 queries):
- Local DB: ~101ms (1ms per query)
- Remote DB: ~5.1s (50ms latency × 101)

Eager Loading (1 query):
- Local DB: ~10ms
- Remote DB: ~50ms

🚀 10-100x faster!
```

## Best Practices

- [ ] **Use eager loading** (`select_related`, `prefetch_related`, `include`)
- [ ] **Batch queries** when eager loading not possible
- [ ] **Use DataLoader** for GraphQL
- [ ] **Enable query logging** in development
- [ ] **Set up monitoring** for query counts in production
- [ ] **Add tests** to verify query counts

## References

- [Django select_related/prefetch_related](https://docs.djangoproject.com/en/stable/ref/models/querysets/#select-related)
- [Sequelize Eager Loading](https://sequelize.org/docs/v6/advanced-association-concepts/eager-loading/)
- [DataLoader for GraphQL](https://github.com/graphql/dataloader)
- [Bullet gem (Rails)](https://github.com/flyerhzm/bullet)
