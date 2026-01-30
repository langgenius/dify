// AUTO-GENERATED — DO NOT EDIT
// Source: https://github.com/anthropics/skills
import type { SkillTemplateNode } from '../types'

const children: SkillTemplateNode[] = [
  {
    "name": "SKILL.md",
    "node_type": "file",
    "content": "---\nname: brand-guidelines\ndescription: Applies Anthropic's official brand colors and typography to any sort of artifact that may benefit from having Anthropic's look-and-feel. Use it when brand colors or style guidelines, visual formatting, or company design standards apply.\nlicense: Complete terms in LICENSE.txt\n---\n\n# Anthropic Brand Styling\n\n## Overview\n\nTo access Anthropic's official brand identity and style resources, use this skill.\n\n**Keywords**: branding, corporate identity, visual identity, post-processing, styling, brand colors, typography, Anthropic brand, visual formatting, visual design\n\n## Brand Guidelines\n\n### Colors\n\n**Main Colors:**\n\n- Dark: `#141413` - Primary text and dark backgrounds\n- Light: `#faf9f5` - Light backgrounds and text on dark\n- Mid Gray: `#b0aea5` - Secondary elements\n- Light Gray: `#e8e6dc` - Subtle backgrounds\n\n**Accent Colors:**\n\n- Orange: `#d97757` - Primary accent\n- Blue: `#6a9bcc` - Secondary accent\n- Green: `#788c5d` - Tertiary accent\n\n### Typography\n\n- **Headings**: Poppins (with Arial fallback)\n- **Body Text**: Lora (with Georgia fallback)\n- **Note**: Fonts should be pre-installed in your environment for best results\n\n## Features\n\n### Smart Font Application\n\n- Applies Poppins font to headings (24pt and larger)\n- Applies Lora font to body text\n- Automatically falls back to Arial/Georgia if custom fonts unavailable\n- Preserves readability across all systems\n\n### Text Styling\n\n- Headings (24pt+): Poppins font\n- Body text: Lora font\n- Smart color selection based on background\n- Preserves text hierarchy and formatting\n\n### Shape and Accent Colors\n\n- Non-text shapes use accent colors\n- Cycles through orange, blue, and green accents\n- Maintains visual interest while staying on-brand\n\n## Technical Details\n\n### Font Management\n\n- Uses system-installed Poppins and Lora fonts when available\n- Provides automatic fallback to Arial (headings) and Georgia (body)\n- No font installation required - works with existing system fonts\n- For best results, pre-install Poppins and Lora fonts in your environment\n\n### Color Application\n\n- Uses RGB color values for precise brand matching\n- Applied via python-pptx's RGBColor class\n- Maintains color fidelity across different systems\n"
  }
]

export default children
