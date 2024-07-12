import Image from 'next/image'
import s from './style.module.css'

const CustomBrainHome = () => {
  return (
    <div className={s.customBrain}>
      <Image src="/brainLogo.svg" alt="Next.js Logo" width={133} height={88} className={s.customBrainLogo} />
      <h1 className="text-3xl my-2">天机亦可泄漏，我是AI智能对话机器人-璇玑AI 平台！</h1>
      <h4 className="text-xl">璇玑是基于大模型技术的新一代AI Bot对话与构建平台，具备智能问答、问数、问图等思考和工具能力，可以快速创建专属的Chat Bot，回答你的多样问题！</h4>
    </div>
  )
}

export default CustomBrainHome
