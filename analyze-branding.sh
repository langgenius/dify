#!/bin/bash

# 品牌引用分析脚本
# 统计所有 "Dify" 品牌引用的位置和数量

echo "================================"
echo "品牌引用分析报告"
echo "================================"
echo ""

# 前端 i18n 文件
echo "📱 前端国际化文件 (i18n)"
echo "--------------------------------"
echo "简体中文 (zh-Hans):"
grep -r "Dify" web/i18n/zh-Hans/*.json 2>/dev/null | wc -l | xargs echo "  引用数量:"
echo ""
echo "英文 (en-US):"
grep -r "Dify" web/i18n/en-US/*.json 2>/dev/null | wc -l | xargs echo "  引用数量:"
echo ""
echo "所有语言总计:"
grep -r "Dify" web/i18n/ --include="*.json" 2>/dev/null | wc -l | xargs echo "  引用数量:"
echo ""

# 前端代码
echo "💻 前端代码 (TypeScript/React)"
echo "--------------------------------"
grep -r "Dify" web/ --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=dist 2>/dev/null | wc -l | xargs echo "引用数量:"
echo ""

# 后端代码
echo "🔧 后端代码 (Python)"
echo "--------------------------------"
grep -r "Dify" api/ --include="*.py" 2>/dev/null | wc -l | xargs echo "引用数量:"
echo ""
echo "主要文件:"
grep -l "Dify" api/*.py 2>/dev/null | head -10
echo ""

# 文档
echo "📚 文档文件 (Markdown)"
echo "--------------------------------"
grep -r "Dify" . --include="*.md" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | wc -l | xargs echo "引用数量:"
echo ""
echo "主要文档:"
grep -l "Dify" *.md 2>/dev/null
echo ""

# Logo 文件
echo "🎨 Logo 和图标文件"
echo "--------------------------------"
echo "Logo 目录内容:"
ls -lh web/public/logo/ 2>/dev/null | grep -v "^total" | awk '{print "  " $9 " (" $5 ")"}'
echo ""

# 配置文件
echo "⚙️  配置文件"
echo "--------------------------------"
echo "package.json:"
grep -n "dify" web/package.json 2>/dev/null | head -5
echo ""

# 许可证
echo "⚖️  许可证文件"
echo "--------------------------------"
if [ -f "LICENSE" ]; then
    echo "LICENSE 文件存在"
    head -5 LICENSE
    echo "..."
else
    echo "未找到 LICENSE 文件"
fi
echo ""

# 总结
echo "================================"
echo "📊 统计总结"
echo "================================"
total_i18n=$(grep -r "Dify" web/i18n/ --include="*.json" 2>/dev/null | wc -l | tr -d ' ')
total_code=$(grep -r "Dify" web/ api/ --include="*.ts" --include="*.tsx" --include="*.py" --exclude-dir=node_modules 2>/dev/null | wc -l | tr -d ' ')
total_docs=$(grep -r "Dify" . --include="*.md" --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | wc -l | tr -d ' ')

echo "i18n 文件引用:    $total_i18n 处"
echo "代码文件引用:     $total_code 处"
echo "文档文件引用:     $total_docs 处"
echo "Logo 文件:        $(ls web/public/logo/ 2>/dev/null | wc -l | tr -d ' ') 个"
echo ""
echo "预估修改文件总数: ~$(( (total_i18n + total_code + total_docs) / 5 )) 个"
echo ""

# 详细清单
echo "================================"
echo "🔍 详细文件清单（前 30 个）"
echo "================================"
echo ""

echo "需要修改的 i18n 文件:"
grep -l "Dify" web/i18n/zh-Hans/*.json 2>/dev/null | head -10 | sed 's/^/  - /'
echo ""

echo "需要修改的代码文件（示例）:"
grep -l "Dify" web/ api/ -r --include="*.ts" --include="*.tsx" --include="*.py" --exclude-dir=node_modules 2>/dev/null | head -10 | sed 's/^/  - /'
echo ""

echo "需要修改的文档文件:"
grep -l "Dify" *.md 2>/dev/null | sed 's/^/  - /'
echo ""

echo "================================"
echo "✅ 分析完成"
echo "================================"
echo ""
echo "提示: 详细的修改计划请查看 REBRANDING_PLAN.md"
echo "      检查清单请查看 BRAND_CHECKLIST.md"
echo ""
