---
description: QAmodeldataset
---

# Dataset of QA model

**The Q\&A paragraph mode feature is different from the normal "Q2P" (question matches paragraph content) matching mode. The "Q2Q" (question matches question) matching mode means that when a user asks a question, the system will find the most similar question to it, and then return the corresponding paragraph as the answer. This method is more precise, because it directly matches the user's question, and can more accurately obtain the information that the user really needs.**

<figure><img src="../../.gitbook/assets/image (63).png" alt=""><figcaption></figcaption></figure>

1.  QA dataset is created by summarizing each paragraph in a document and generating QA pairs from the summaries. This process summarizes the information in each paragraph and breaks it down to extract valuable insights for the user.

    <figure><img src="../../.gitbook/assets/image (65).png" alt=""><figcaption></figcaption></figure>



    <figure><img src="../../.gitbook/assets/image (67).png" alt=""><figcaption></figcaption></figure>
2.  At the same time, we support custom additions and modifications to the segmentation. Users can dynamically adjust their own segmentation information to make your dataset more precise.

    ![](<../../.gitbook/assets/image (68).png>)![](<../../.gitbook/assets/image (69).png>)
3. The problem text has a complete syntactic structure of natural language, rather than some keywords in a document retrieval task. Therefore, matching Q to Q makes the semantics and matching clearer while satisfying some high-frequency and high-similarity question scenarios.
