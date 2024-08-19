import { cn } from "./utils ";

interface FeatureSectionProps {
  top: React.ReactNode;
  left: React.ReactNode;
  right: React.ReactNode;
  borderColor: string;
}

export default function FeatureSection({
  top,
  left,
  right,
  borderColor,
}: FeatureSectionProps) {
  return (
    <div
      id="features"
      className={cn(
        "flex flex-col items-center justify-center max-w-7xl border p-6 rounded-xl mx-2 lg:mx-auto gap-12 my-10",
        borderColor
      )}
    >
      {top}
      <div className="grid grid-cols-2 gap-x-8 w-full p-3">
        <div className="w-full col-span-2 lg:col-span-1">{left}</div>
        <div className="w-full hidden lg:block ">{right}</div>
      </div>
    </div>
  );
}
