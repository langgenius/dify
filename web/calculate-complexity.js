// https://www.sonarsource.com/blog/5-clean-code-tips-for-reducing-cognitive-complexity/
const fs = require('fs');
const { Linter } = require('eslint');
const sonarPlugin = require('eslint-plugin-sonarjs');
const tsParser = require('@typescript-eslint/parser');

const linter = new Linter();

const config = {
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      ecmaFeatures: {
        jsx: true
      }
    }
  },
  plugins: {
    sonarjs: sonarPlugin,
  },
  rules: {
    'sonarjs/cognitive-complexity': ['error', 0], // always show error
  },
};

function getFileComplexity(filePath) {
  try {
    const code = fs.readFileSync(filePath, 'utf8');

    const messages = linter.verify(code, config);

    let totalFileComplexity = 0;
    let maxFileComplexityIndex = 0;
    const functionComplexities = [];

    messages.forEach((msg) => {
      // console.log(msg);
      if (msg.ruleId === 'sonarjs/cognitive-complexity') {
        const match = msg.message.match(/reduce its Cognitive Complexity from (\d+)/);
        if (match && match[1]) {
          const score = parseInt(match[1], 10);
          totalFileComplexity += score;
          if (score > functionComplexities[maxFileComplexityIndex]?.score || functionComplexities.length === 0) {
            maxFileComplexityIndex = functionComplexities.length;
          }

          functionComplexities.push({
            line: msg.line,
            // functionName: extractFunctionName(code, msg.line), // 可选：尝试获取函数名
            score: score,
            // message: msg.message
          });
        }
      }
    });

    return {
      file: filePath,
      totalComplexity: totalFileComplexity,
      maxFileComplexity: functionComplexities[maxFileComplexityIndex],
      details: functionComplexities
    };

  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
    return null;
  }
}

// const targetFile = './app/components/share/text-generation/run-once/index.tsx'; // "totalComplexity": 22
const targetFile = './app/components/share/text-generation/index.tsx'; // 90, max: 41
// const targetFile = './app/components/workflow/nodes/_base/components/workflow-panel/index.tsx'; // 33
// const targetFile = './app/components/app/configuration/index.tsx'; // 111, max: 26


const result = getFileComplexity(targetFile);
console.log(JSON.stringify(result, null, 2));
