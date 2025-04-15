
def _parse_config(self, content: str) -> dict:
    config = {}
    if not content:
        return config

    for line in content.splitlines():
        # 清理行首尾空白并跳过空行/注释
        cleaned_line = line.strip()
        if not cleaned_line or cleaned_line.startswith(('#', '!')):
            continue

        # 查找第一个有效分隔符（=或:）
        separator_index = -1
        for i, c in enumerate(cleaned_line):
            if c in ('=', ':') and (i == 0 or cleaned_line[i-1] != '\\'):
                separator_index = i
                break

        if separator_index == -1:
            continue  # 无效行忽略

        # 分割键值
        key = cleaned_line[:separator_index].strip()
        raw_value = cleaned_line[separator_index+1:].strip()

        # 处理转义字符（包含Java properties标准转义规则）
        try:
            # 转换标准转义序列（如 \t \n \u0020 等）
            decoded_value = bytes(raw_value, 'utf-8').decode('unicode_escape')
            # 处理自定义转义分隔符（如 \= \:）
            decoded_value = decoded_value.replace(r'\=', '=').replace(r'\:', ':')
        except UnicodeDecodeError:
            decoded_value = raw_value  # 解码失败时保持原始值

        config[key] = decoded_value

    return config
