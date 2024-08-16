import type { FC } from "react";
import cn from "@/utils/classnames";
import { motion } from "framer-motion";

type Option = {
  value: string;
  text: string;
  icon?: React.ReactNode;
};
type TabSliderProps = {
  className?: string;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
};
const TabSliderNew: FC<TabSliderProps> = ({
  className,
  value,
  onChange,
  options,
}) => {
  return (
    <div
      className={cn(className, "relative flex p-1 bg-zinc-300/50 rounded-lg")}
    >
      {options.map((option) => (
        <div
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "mr-1 px-3 py-[7px] h-[32px] relative z-10 flex items-center rounded-lg border-[0.5px] border-transparent text-gray-700 text-[13px] font-medium leading-[18px] cursor-pointer ",
            value === option.value && "  text-primary-600 "
          )}
        >
          {option.icon}
          {option.text}
          {value === option.value && (
            <motion.div
              layoutId="option-blob"
              className="absolute inset-0 -z-10 rounded-lg bg-white shadow-xs border-gray-300"
            ></motion.div>
          )}
        </div>
      ))}
    </div>
  );
};

export default TabSliderNew;
