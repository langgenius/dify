# EU AI Act Compliance Guide for Dify Deployers

Dify is an LLMOps platform for building RAG pipelines, agents, and AI workflows. If you deploy Dify in the EU — whether self-hosted or using a cloud provider — the EU AI Act applies to your deployment. This guide covers what the regulation requires and how Dify's architecture maps to those requirements.

## Self-hosted vs cloud: different compliance profiles

| Deployment | Your role | Dify's role | Who handles compliance? |
|-----------|----------|-------------|------------------------|
| **Self-hosted** | Provider and deployer | Framework provider (no obligations unless marketed as complete system) | You |
| **Dify Cloud** | Deployer | Provider and processor | Shared — Dify handles SOC 2 and GDPR for the platform; you handle AI Act obligations for your specific use case |

Dify Cloud already has SOC 2 Type II and GDPR compliance for the platform itself. But the EU AI Act adds obligations specific to AI systems that SOC 2 does not cover: risk classification, technical documentation, transparency, and human oversight.

## What the scanner found

Running [AI Trace Auditor](https://github.com/BipinRimal314/ai-trace-auditor) against the Dify codebase:

- **Files scanned:** 8,275
- **AI providers detected:** HuggingFace (core), plus integrations with OpenAI, Anthropic, Google, and 100+ models via provider plugins
- **Model identifiers:** 21 (gpt-4o, gpt-3.5-turbo, claude-3-opus, gemini-2.5-flash, whisper-1, etc.)
- **Vector database connections:** 49 (extensive RAG infrastructure)
- **External services:** 11
- **Data flows:** 11

Dify's plugin architecture means actual provider usage depends on your configuration. Document which providers and models are active in your deployment.

## Data flow diagram

A typical Dify RAG deployment:

```mermaid
graph LR
    USER((User)) -->|query| DIFY[Dify Platform]
    DIFY -->|prompts| LLM([LLM Provider])
    LLM -->|responses| DIFY
    DIFY -->|documents| EMBED([Embedding Model])
    EMBED -->|vectors| DIFY
    DIFY -->|store/retrieve| VS[(Vector Store)]
    DIFY -->|knowledge| KB[(Knowledge Base)]
    DIFY -->|response| USER

    classDef processor fill:#60a5fa,stroke:#1e40af,color:#000
    classDef controller fill:#4ade80,stroke:#166534,color:#000
    classDef app fill:#a78bfa,stroke:#5b21b6,color:#000
    classDef user fill:#f472b6,stroke:#be185d,color:#000

    class USER user
    class DIFY app
    class LLM processor
    class EMBED processor
    class VS controller
    class KB controller
```

**GDPR roles:**
- **Cloud LLM providers (OpenAI, Anthropic, Google):** Processor — requires DPA
- **Cloud embedding services:** Processor — requires DPA
- **Self-hosted vector stores (Weaviate, Qdrant, pgvector):** Controller — no third-party transfer
- **Cloud vector stores (Pinecone, Zilliz Cloud):** Processor — requires DPA
- **Knowledge base documents:** Controller — stored in your infrastructure

## Article 11: Technical documentation

High-risk systems need Annex IV documentation. For Dify deployments, key sections include:

| Section | What Dify provides | What you must document |
|---------|-------------------|----------------------|
| General description | Platform capabilities, supported models | Your specific use case, intended users, deployment context |
| Development process | Dify's architecture, plugin system | Your RAG pipeline design, prompt engineering, knowledge base curation |
| Monitoring | Dify's built-in logging and analytics | Your monitoring plan, alert thresholds, incident response |
| Performance metrics | Dify's evaluation features | Your accuracy benchmarks, quality thresholds, bias testing |
| Risk management | — | Risk assessment for your specific use case |

Generate a starting template:

```bash
pip install ai-trace-auditor
aitrace docs ./your-dify-deployment -o annex-iv-docs.md
```

## Article 12: Record-keeping

Dify's built-in logging covers several Article 12 requirements:

| Requirement | Dify Feature | Status |
|------------|-------------|--------|
| Conversation logs | Full conversation history with timestamps | **Covered** |
| Model tracking | Model name recorded per interaction | **Covered** |
| Token usage | Token counts per message | **Covered** |
| Cost tracking | Cost per conversation (if provider reports it) | **Partial** |
| Document retrieval | RAG source documents logged | **Covered** |
| User identification | User session tracking | **Covered** |
| Error logging | Failed generation logs | **Covered** |
| Data retention | Configurable | **Your responsibility** |

Set your data retention policy to at least 6 months for Article 12 compliance.

## Article 13: Transparency

For Dify applications serving end users:

1. **Disclose AI involvement** — tell users they are interacting with an AI system
2. **Source attribution** — Dify's RAG pipeline can show which documents informed the response. Enable this for transparency.
3. **Model identification** — document which LLM model generates responses
4. **Limitations** — disclose known limitations: hallucination risk, knowledge cutoff dates, confidence boundaries

Dify's "citation" feature in RAG applications directly supports transparency by showing users which knowledge base documents informed the answer.

## Article 14: Human oversight

For high-risk applications:

- **Annotation/feedback system:** Dify includes annotation features for human review of AI outputs
- **Moderation:** Built-in content moderation can filter responses before they reach users
- **Rate limiting:** Controls on API usage prevent runaway AI behavior
- **Workflow control:** Dify's workflow builder allows inserting human review steps between AI generation and output delivery

### Recommended pattern

For high-risk use cases (HR, legal, medical), configure your Dify workflow to require human approval before the AI response is delivered to the end user or acted upon.

## Knowledge base compliance

Dify's knowledge base feature has specific compliance implications:

1. **Data provenance:** Document where your knowledge base documents come from. Article 10 requires data governance for training data; knowledge bases are analogous.
2. **Update tracking:** When you add, remove, or update documents in the knowledge base, log the change. The AI system's behavior changes with its knowledge base.
3. **PII in documents:** If knowledge base documents contain personal data, GDPR applies to the entire RAG pipeline. Implement access controls and consider PII redaction before indexing.
4. **Copyright:** Ensure you have the right to use the documents in your knowledge base for AI-assisted generation.

## GDPR considerations

1. **Legal basis** (Article 6): Document why AI processing of user queries is necessary
2. **Data Processing Agreements** (Article 28): Required for each cloud LLM and embedding provider
3. **Data minimization:** Only include necessary context in prompts; avoid sending entire documents when a relevant excerpt suffices
4. **Right to erasure:** If a user requests deletion, ensure their conversations are removed from Dify's logs AND any vector store entries derived from their data
5. **Cross-border transfers:** Cloud providers based outside the EEA require Standard Contractual Clauses

## Full compliance scan

```bash
pip install ai-trace-auditor
aitrace comply ./your-dify-deployment --split -o compliance/
```

## Resources

- [EU AI Act full text](https://artificialintelligenceact.eu/)
- [Dify documentation](https://docs.dify.ai/)
- [Dify SOC 2 compliance](https://dify.ai/trust)
- [AI Trace Auditor](https://github.com/BipinRimal314/ai-trace-auditor) — open-source compliance scanning

---

*This guide was generated with assistance from [AI Trace Auditor](https://github.com/BipinRimal314/ai-trace-auditor) and reviewed for accuracy. It is not legal advice. Consult a qualified professional for compliance decisions.*
