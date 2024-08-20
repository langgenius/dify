import { RiCheckboxCircleLine } from "@remixicon/react";
import cn from "@/utils/classnames";
import Image from "next/image";

type ColorScheme = "blue" | "green" | "yellow" | "purple" | "pink";

interface FeatureCardProps {
  imageDirection?: "left" | "right";
  features: string[];
  colorScheme: ColorScheme;
  icon: React.ReactNode;
  title: string;
  description: string;
  imageSrc: string;
  targetKey: string;
}

export default function UseCaseCard({
  features,
  targetKey,
  colorScheme,
  icon,
  title,
  description,
  imageSrc,
  imageDirection = "left",
}: FeatureCardProps) {
  const colorClasses = {
    blue: {
      gradient: "from-blue-100 via-blue-50 to-white",
      text: "text-blue-700",
      shadow: "rgba(59, 130, 246, 0.1)", // blue-100 as rgba
    },
    green: {
      gradient: "from-green-100 via-green-50 to-white",
      text: "text-green-700",
      shadow: "rgba(16, 185, 129, 0.1)", // green-100 as rgba
    },
    yellow: {
      gradient: "from-yellow-100 via-yellow-50 to-white",
      text: "text-yellow-700",
      shadow: "rgba(252, 211, 77, 0.1)", // yellow-100 as rgba
    },
    purple: {
      gradient: "from-purple-100 via-purple-50 to-white",
      text: "text-purple-700",
      shadow: "rgba(167, 139, 250, 0.1)", // purple-100 as rgba
    },
    pink: {
      gradient: "from-pink-100 via-pink-50 to-white",
      text: "text-pink-700",
      shadow: "rgba(236, 72, 153, 0.1)", // pink-100 as rgba
    },
  };

  const { gradient, text, shadow } = colorClasses[colorScheme];

  return (
    <div
      id={targetKey}
      className={cn(
        "flex sticky top-20 flex-col items-center justify-center max-w-7xl border p-6  lg:p-12 lg:pb-0 rounded-xl mx-2 lg:mx-auto gap-12 bg-gradient-to-b  overflow-hidden",
        gradient
      )}
    >
      <div
        className={cn(
          "flex bg-white justify-between gap-2 items-center mx-auto  p-3 px-5 rounded-full text-xl sm:text-2xl font-semibold",
          `custom-shadow-${colorScheme}`
        )}
      >
        {icon}
        <h1 className="text-center  font-medium">{title}</h1>
      </div>
      <div className="grid grid-cols-3 gap-x-10 w-full ">
        <div className={cn("w-full col-span-3 lg:col-span-2", "lg:ml-24")}>
          <div className="flex flex-col gap-6">
            <h1 className="text-xl sm:text-3xl max-w-lg   font-semibold">
              {description}
            </h1>
            <div className="flex flex-col gap-3">
              {features.map((feature, index) => (
                <div key={index} className="flex gap-2">
                  <RiCheckboxCircleLine className={cn("size-6", text)} />
                  <h1 className="text-base sm:text-lg">{feature}</h1>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          className={cn(
            "w-full hidden max-h-[400px] overflow-hidden lg:block ",
            imageDirection === "left" && "order-first"
          )}
          style={{
            boxShadow: `1px -1px 24px 14px ${shadow}`,
          }}
        >
          <Image
            src={imageSrc}
            alt="feature image"
            className="object-contain aspect-auto border-[15px] border-gray-100 rounded-2xl "
            width={500}
            height={900}
            quality={100}
          />
        </div>
      </div>
    </div>
  );
}
