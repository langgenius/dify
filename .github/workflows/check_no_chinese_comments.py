import os
import re
from zhon.hanzi import punctuation

def has_chinese_characters(text):
    for char in text:
        if '\u4e00' <= char <= '\u9fff' or char in punctuation:
            return True
    return False

def check_file_for_chinese_comments(file_path):
    with open(file_path, 'r', encoding='utf-8') as file:
        for line_number, line in enumerate(file, start=1):
            if has_chinese_characters(line):
                print(f"Found Chinese characters in {file_path} on line {line_number}:")
                print(line.strip())
                return True
    return False

def main():
    has_chinese = False
    excluded_files = ["model_template.py", 'stopwords.py', 'commands.py',
                      'indexing_runner.py', 'web_reader_tool.py', 'spark_provider.py',
                      'prompts.py']

    for root, _, files in os.walk("."):
        for file in files:
            if file.endswith(".py") and file not in excluded_files:
                file_path = os.path.join(root, file)
                if check_file_for_chinese_comments(file_path):
                    has_chinese = True

    if has_chinese:
        raise Exception("Found Chinese characters in Python files. Please remove them.")

if __name__ == "__main__":
    main()
