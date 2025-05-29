## PostgreSQL High Availability Notes

For a production-ready high-availability (HA) Dify setup, it is **strongly recommended to use an external, managed PostgreSQL database service**. Examples include AWS RDS, Google Cloud SQL, or Azure Database for PostgreSQL. These services offer built-in HA, automated backups, and easier maintenance compared to a self-managed database.

Dify uses the following standard environment variables to connect to your PostgreSQL database. You will need to configure these in your `.env` file or deployment environment:

*   `DB_HOST`: The hostname or IP address of your PostgreSQL server.
*   `DB_PORT`: The port number your PostgreSQL server is listening on (typically 5432).
*   `DB_USERNAME`: The username for connecting to the database.
*   `DB_PASSWORD`: The password for the specified username.
*   `DB_DATABASE`: The name of the database Dify will use.

**Important:** The `docker-compose.ha.yml` file provided in this repository includes a single `db` service running PostgreSQL. While this is convenient for development or testing, it represents a **single point of failure** in an HA context. If this containerized PostgreSQL instance fails, your Dify application will become unavailable.

Setting up a truly HA PostgreSQL cluster (e.g., with replication and failover) within Docker Compose is complex and generally not recommended for production environments. Such setups often require specialized knowledge and tools (like Patroni, Stolon, or pg_auto_failover) and can be brittle if not managed carefully.

If you choose to use the single PostgreSQL instance provided in `docker-compose.ha.yml` for any reason, **ensure you have a robust and regularly tested data backup and recovery strategy in place.** Data loss can occur if the container or its volume is corrupted or accidentally deleted.
