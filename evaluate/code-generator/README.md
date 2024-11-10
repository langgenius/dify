# Code Generator Evaluator

## Getting Started
1. Move to the evaluator directory

```bash
cd dify/evaluate/code-generator
```

2. Set up your `.env` file with required variables
```bash
cp .env.example .env
```

3. Add your test cases to `testdata/testcases.json`


4. Execute the evaluator

```bash
# For Linux
./bin/evaluate-code-linux

# For macOS (Intel)
./bin/evaluate-code-mac

# For macOS (Apple Silicon)
./bin/evaluate-code-mac-arm64

# For Windows
./bin/evaluate-code.exe
```


## Build Instructions

### 1. Prepare Build Script
First, grant execution permissions to the build script:
```bash
chmod +x build.sh
```

### 2. Prerequisites
- Go 1.20 or higher
- Properly configured `GOPATH`

### 3. Build Process
Run the cross-platform build with the following command:
```bash
./build.sh
```

## Running the Evaluator
Execute the Code Generator evaluation on your platform using:

```bash
# For Linux
./bin/evaluate-code-linux

# For macOS (Intel)
./bin/evaluate-code-mac

# For macOS (Apple Silicon)
./bin/evaluate-code-mac-arm64

# For Windows
./bin/evaluate-code.exe
```
