// https://www.sonarsource.com/blog/5-clean-code-tips-for-reducing-cognitive-complexity/
const fs = require('fs');
const path = require('path');
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
      maxComplexityInfo: functionComplexities[maxFileComplexityIndex],
      details: functionComplexities
    };

  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
    return null;
  }
}

function collectTsxFiles(baseDir) {
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const files = [];

  entries.forEach((entry) => {
    const fullPath = path.join(baseDir, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name.startsWith('.') ||
        entry.name === '__test__' ||
        entry.name === '__tests__'
      ) {
        return;
      }
      files.push(...collectTsxFiles(fullPath));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.tsx') &&
      !entry.name.endsWith('.spec.tsx') &&
      !entry.name.endsWith('.test.tsx')
    ) {
      files.push(fullPath);
    }
  });

  return files;
}

function writeCsv(results, outputPath) {
  const header = 'File,Total Complexity,Max Complexity,Max Complexity Line';
  const rows = results.map(({ file, totalComplexity, maxComplexityInfo }) => {
    const maxScore = maxComplexityInfo?.score ?? 0;
    const maxLine = maxComplexityInfo?.line ?? '';
    const targetFile = JSON.stringify(path.relative(process.cwd(), file));
    return `${targetFile},${totalComplexity},${maxScore},${maxLine}`;
  });

  fs.writeFileSync(outputPath, [header, ...rows].join('\n'), 'utf8');
}

function main() {
  const projectRoot = process.cwd();
  const tsxFiles = collectTsxFiles(projectRoot);
  const results = tsxFiles
    .map(getFileComplexity)
    .filter((item) => item && item.totalComplexity > 0)
    .sort((a, b) => b.maxComplexityInfo?.score - a.maxComplexityInfo?.score);

  const outputPath = path.join(projectRoot, 'complexity-report.csv');
  writeCsv(results, outputPath);
  console.log(`CSV report written to ${outputPath}`);
}

main();
