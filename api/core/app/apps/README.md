## Guidelines for Database Connection Management in App Runner and Task Pipeline

Due to the presence of tasks in App Runner that require long execution times, such as LLM generation and external requests, Flask-Sqlalchemy's strategy for database connection pooling is to allocate one connection (transaction) per request. This approach keeps a connection occupied even during non-DB tasks, leading to the inability to acquire new connections during high concurrency requests due to multiple long-running tasks.

Therefore, the database operations in App Runner and Task Pipeline must ensure connections are closed immediately after use, and it's better to pass IDs rather than Model objects to avoid deattach errors.

Examples:

1. Creating a new record:

   ```python
   app = App(id=1)
   db.session.add(app)
   db.session.commit()
   db.session.refresh(app)  # Retrieve table default values, like created_at, cached in the app object, won't affect after close
   
   # Handle non-long-running tasks or store the content of the App instance in memory (via variable assignment).
   
   db.session.close()
   
   return app.id
   ```

2. Fetching a record from the table:

   ```python
   app = db.session.query(App).filter(App.id == app_id).first()
    
   created_at = app.created_at
    
   db.session.close()
   
   # Handle tasks (include long-running).
   
   ```

3. Updating a table field:

   ```python
   app = db.session.query(App).filter(App.id == app_id).first()

   app.updated_at = time.utcnow()
   db.session.commit()
   db.session.close()

   return app_id
   ```
   
