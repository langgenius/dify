## Vector Store High Availability (HA) Notes

### Weaviate

For a production-ready high-availability (HA) Dify setup that utilizes Weaviate as the vector store, it is **strongly recommended to use an external, managed vector database service or set up a dedicated Weaviate cluster**.

*   **External Managed Service:** Consider cloud providers that offer managed Weaviate or other vector database services with built-in HA capabilities.
*   **Dedicated Weaviate Cluster:** Refer to the [official Weaviate documentation](https://weaviate.io/developers/weaviate/concepts/cluster) for instructions on setting up a multi-node Weaviate cluster, typically on a platform like Kubernetes, for resilience and scalability.

Dify uses the following environment variables to connect to your Weaviate instance. You will need to configure these in your `.env` file or deployment environment:

*   `VECTOR_STORE=weaviate` (Ensure this is set to select Weaviate)
*   `WEAVIATE_ENDPOINT=<your_external_weaviate_endpoint>`
    *   Example: `http://your-weaviate-node1:8080` or the endpoint of your load balancer in front of the cluster.
*   `WEAVIATE_API_KEY=<your_weaviate_api_key>`
    *   Set this if your Weaviate instance or cluster requires API key authentication.

**Important Note on the Provided `docker-compose.ha.yml`:**

The `docker-compose.ha.yml` file includes a single `weaviate` service. While this is convenient for development or testing, it represents a **single point of failure** in an HA context. If this containerized Weaviate instance fails, operations relying on vector search (e.g., knowledge base retrieval) will be disrupted.

Setting up a truly HA Weaviate cluster within Docker Compose is complex and generally not recommended for production due to the intricacies of networking, data replication, and sharding management in that environment.

If you choose to use the single Weaviate instance provided in `docker-compose.ha.yml` for any reason, **ensure you have a robust and regularly tested data backup and recovery strategy for your vector embeddings.** Data loss can occur if the container or its volume is corrupted or accidentally deleted.

### Other Vector Stores

Dify supports various vector stores (e.g., Qdrant, Milvus, PGVector). If you choose a vector store other than Weaviate, you are responsible for investigating and implementing its specific high-availability mechanisms. Consult the official documentation for your chosen vector store for best practices on HA deployment. Ensure you update the relevant Dify environment variables (e.g., `QDRANT_URL`, `MILVUS_URI`, etc.) to point to your HA setup.
