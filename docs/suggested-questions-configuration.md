# Configurable Suggested Questions After Answer

This document explains how to configure the "Suggested Questions After Answer" feature in Dify using environment variables.

## Overview

The suggested questions feature generates follow-up questions after each AI response to help users continue the conversation. By default, Dify generates 3 short questions (under 20 characters each), but you can customize this behavior to better fit your specific use case.

## Environment Variables

### `SUGGESTED_QUESTIONS_PROMPT`

**Description**: Custom prompt template for generating suggested questions.

**Default**:

```
Please help me predict the three most likely questions that human would ask, and keep each question under 20 characters.
MAKE SURE your output is the SAME language as the Assistant's latest response.
The output must be an array in JSON format following the specified schema:
["question1","question2","question3"]
```

**Usage Examples**:

1. **Technical/Developer Questions (Your Use Case)**:

   ```bash
   export SUGGESTED_QUESTIONS_PROMPT='Please help me predict the five most likely technical follow-up questions a developer would ask. Focus on implementation details, best practices, and architecture considerations. Keep each question between 40-60 characters. Output must be JSON array: ["question1","question2","question3","question4","question5"]'
   ```

1. **Customer Support**:

   ```bash
   export SUGGESTED_QUESTIONS_PROMPT='Generate 3 helpful follow-up questions that guide customers toward solving their own problems. Focus on troubleshooting steps and common issues. Keep questions under 30 characters. JSON format: ["q1","q2","q3"]'
   ```

1. **Educational Content**:

   ```bash
   export SUGGESTED_QUESTIONS_PROMPT='Create 4 thought-provoking questions that help students deeper understand the topic. Focus on concepts, relationships, and applications. Questions should be 25-40 characters. JSON: ["question1","question2","question3","question4"]'
   ```

1. **Multilingual Support**:

   ```bash
   export SUGGESTED_QUESTIONS_PROMPT='Generate exactly 3 follow-up questions in the same language as the conversation. Adapt question length appropriately for the language (Chinese: 10-15 chars, English: 20-30 chars, Arabic: 25-35 chars). Always output valid JSON array.'
   ```

**Important Notes**:

- The prompt must request JSON array output format
- Include language matching instructions for multilingual support
- Specify clear character limits or question count requirements
- Focus on your specific domain or use case

### `SUGGESTED_QUESTIONS_MAX_TOKENS`

**Description**: Maximum number of tokens for the LLM response.

**Default**: `256`

**Usage**:

```bash
export SUGGESTED_QUESTIONS_MAX_TOKENS=512  # For longer questions or more questions
```

**Recommended Values**:

- `256`: Default, good for 3-4 short questions
- `384`: Medium, good for 4-5 medium-length questions
- `512`: High, good for 5+ longer questions or complex prompts
- `1024`: Maximum, for very complex question generation

### `SUGGESTED_QUESTIONS_TEMPERATURE`

**Description**: Temperature parameter for LLM creativity.

**Default**: `0.0`

**Usage**:

```bash
export SUGGESTED_QUESTIONS_TEMPERATURE=0.3  # Balanced creativity
```

**Recommended Values**:

- `0.0-0.2`: Very focused, predictable questions (good for technical support)
- `0.3-0.5`: Balanced creativity and relevance (good for general use)
- `0.6-0.8`: More creative, diverse questions (good for brainstorming)
- `0.9-1.0`: Maximum creativity (good for educational exploration)

## Configuration Examples

### Example 1: Developer Documentation Chatbot

```bash
# .env file
SUGGESTED_QUESTIONS_PROMPT='Generate exactly 5 technical follow-up questions that developers would ask after reading code documentation. Focus on implementation details, edge cases, performance considerations, and best practices. Each question should be 40-60 characters long. Output as JSON array: ["question1","question2","question3","question4","question5"]'
SUGGESTED_QUESTIONS_MAX_TOKENS=512
SUGGESTED_QUESTIONS_TEMPERATURE=0.3
```

### Example 2: Customer Service Bot

```bash
# .env file
SUGGESTED_QUESTIONS_PROMPT='Create 3 actionable follow-up questions that help customers resolve their own issues. Focus on common problems, troubleshooting steps, and product features. Keep questions simple and under 25 characters. JSON: ["q1","q2","q3"]'
SUGGESTED_QUESTIONS_MAX_TOKENS=256
SUGGESTED_QUESTIONS_TEMPERATURE=0.1
```

### Example 3: Educational Tutor

```bash
# .env file
SUGGESTED_QUESTIONS_PROMPT='Generate 4 thought-provoking questions that help students deepen their understanding of the topic. Focus on relationships between concepts, practical applications, and critical thinking. Questions should be 30-45 characters. Output: ["question1","question2","question3","question4"]'
SUGGESTED_QUESTIONS_MAX_TOKENS=384
SUGGESTED_QUESTIONS_TEMPERATURE=0.6
```

## Implementation Details

### How It Works

1. **Environment Variable Loading**: The system checks for environment variables at startup
1. **Fallback to Defaults**: If no environment variables are set, original behavior is preserved
1. **Prompt Template**: The custom prompt is used as-is, allowing full control over question generation
1. **LLM Parameters**: Custom max_tokens and temperature are passed to the LLM API
1. **JSON Parsing**: The system expects JSON array output and parses it accordingly

### File Changes

The implementation modifies these files:

- `api/core/llm_generator/prompts.py`: Environment variable support
- `api/core/llm_generator/llm_generator.py`: Custom LLM parameters
- `api/.env.example`: Documentation of new variables

### Backward Compatibility

- ✅ **Zero Breaking Changes**: Works exactly as before if no environment variables are set
- ✅ **Default Behavior Preserved**: Original prompt and parameters used as fallbacks
- ✅ **No Database Changes**: Pure environment variable configuration
- ✅ **No UI Changes Required**: Configuration happens at deployment level

## Testing Your Configuration

### Local Testing

1. Set environment variables:

   ```bash
   export SUGGESTED_QUESTIONS_PROMPT='Your test prompt...'
   export SUGGESTED_QUESTIONS_MAX_TOKENS=300
   export SUGGESTED_QUESTIONS_TEMPERATURE=0.4
   ```

1. Start Dify API:

   ```bash
   cd api
   python -m flask run --host 0.0.0.0 --port=5001 --debug
   ```

1. Test the feature in your chat application and verify the questions match your expectations.

### Monitoring

Monitor the following when testing:

- **Question Quality**: Are questions relevant and helpful?
- **Language Matching**: Do questions match the conversation language?
- **JSON Format**: Is output properly formatted as JSON array?
- **Length Constraints**: Do questions follow your length requirements?
- **Response Time**: Are the custom parameters affecting performance?

## Troubleshooting

### Common Issues

1. **Invalid JSON Output**:

   - **Problem**: LLM doesn't return valid JSON
   - **Solution**: Make sure your prompt explicitly requests JSON array format

1. **Questions Too Long/Short**:

   - **Problem**: Questions don't follow length constraints
   - **Solution**: Be more specific about character limits in your prompt

1. **Too Few/Many Questions**:

   - **Problem**: Wrong number of questions generated
   - **Solution**: Clearly specify the exact number in your prompt

1. **Language Mismatch**:

   - **Problem**: Questions in wrong language
   - **Solution**: Include explicit language matching instructions in prompt

1. **Performance Issues**:

   - **Problem**: Slow response times
   - **Solution**: Reduce `SUGGESTED_QUESTIONS_MAX_TOKENS` or simplify prompt

### Debug Logging

To debug your configuration, you can temporarily add logging to see the actual prompt and parameters being used:

```python
import logging
logger = logging.getLogger(__name__)

# In llm_generator.py
logger.info(f"Suggested questions prompt: {prompt}")
logger.info(f"Max tokens: {SUGGESTED_QUESTIONS_MAX_TOKENS}")
logger.info(f"Temperature: {SUGGESTED_QUESTIONS_TEMPERATURE}")
```

## Migration Guide

### From Default Configuration

If you're currently using the default configuration and want to customize:

1. **Assess Your Needs**: Determine what aspects need customization (question count, length, domain focus)
1. **Design Your Prompt**: Write a custom prompt that addresses your specific use case
1. **Choose Parameters**: Select appropriate max_tokens and temperature values
1. **Test Incrementally**: Start with small changes and test thoroughly
1. **Deploy Gradually**: Roll out to production after successful testing

### Best Practices

1. **Start Simple**: Begin with minimal changes to the default prompt
1. **Test Thoroughly**: Test with various conversation types and languages
1. **Monitor Performance**: Watch for impact on response times and costs
1. **Get User Feedback**: Collect feedback on question quality and relevance
1. **Iterate**: Refine your configuration based on real-world usage

## Future Enhancements

This environment variable approach provides immediate customization while maintaining backward compatibility. Future enhancements could include:

1. **App-Level Configuration**: Different apps with different suggested question settings
1. **Dynamic Prompts**: Context-aware prompts based on conversation content
1. **Multi-Model Support**: Different models for different types of questions
1. **Analytics Dashboard**: Insights into question effectiveness and usage patterns
1. **A/B Testing**: Built-in testing of different prompt configurations

For now, the environment variable approach offers a simple, reliable way to customize the suggested questions feature for your specific needs.
