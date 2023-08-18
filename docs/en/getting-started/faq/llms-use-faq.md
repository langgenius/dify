# LLMs-use-FAQ

### 1. How to choose a basic model?

**gpt-3.5-turbo**
•gpt-3.5-turbo is an upgraded version of the gpt-3 model series. It is more powerful than gpt-3 and can handle more complex tasks. It has significant improvements in understanding long text and cross-document reasoning. Gpt-3.5 turbo can generate more coherent and persuasive text. It also has great improvements in summarization, translation and creative writing. **Good at: Long text understanding, cross-document reasoning, summary, translation, creative writing**

**gpt-4**
•gpt-4 is the latest and most powerful Transformer language model. It has nearly 200 billion pre-trained parameters, making it state-of-the-art on all language tasks, especially those requiring deep understanding and generation of long, complex responses. Gpt-4 can handle all aspects of human language, including understanding abstract concepts and cross-page reasoning. Gpt-4 is the first true general language understanding system that can handle any natural language processing task in the field of artificial intelligence. **Good at: \*All NLP tasks, language understanding, long text generation, cross-document reasoning, understanding abstract concepts\***Please refer to: [https://platform.openai.com/docs/models/overview](https://platform.openai.com/docs/models/overview)

### 2. Why is it recommended to set max_tokens smaller?

Because in natural language processing, longer text outputs usually require longer computation time and more computing resources. Therefore, limiting the length of the output text can reduce the computational cost and time to some extent. For example, set: max_tokens=500, which means that only the first 500 tokens of the output text are considered, and the part exceeding this length will be discarded. The purpose of doing so is to ensure that the length of the output text does not exceed the acceptable range of the LLM, while making full use of computing resources to improve the efficiency of the model. On the other hand, more often limiting max_tokens can increase the length of the prompt, such as the limit of gpt-3.5-turbo is 4097 tokens, if you set max_tokens=4000, then only 97 tokens are left for the prompt, and an error will be reported if exceeded.

### 3. How to split long text data in the dataset reasonably?

In some natural language processing applications, text is often split into paragraphs or sentences for better processing and understanding of semantic and structural information in the text. The minimum splitting unit depends on the specific task and technical implementation. For example:

• For text classification tasks, text is usually split into sentences or paragraphs.

• For machine translation tasks, entire sentences or paragraphs need to be used as splitting units.

Finally, experiments and evaluations are still needed to determine the most suitable embedding technology and splitting unit. The performance of different technologies and splitting units can be compared on the test set to select the optimal scheme.

### 4. What distance function did we use when getting dataset segmentation?

We use [cosine similarity](https://en.wikipedia.org/wiki/Cosine_similarity). The choice of distance function is usually irrelevant. OpenAI embeddings are normalized to length 1, which means:

•Using the dot product to calculate cosine similarity can be slightly faster •Cosine similarity and Euclidean distance will lead to the same ranking

After the embedding vectors are normalized to length 1, calculating the cosine similarity between two vectors can be simplified to their dot product. Because the normalized vectors have a length of 1, the result of the dot product is equal to the result of the cosine similarity.

Since the dot product calculation is faster than other similarity metrics (such as Euclidean distance), using normalized vectors for dot product calculation can slightly improve computational efficiency.
