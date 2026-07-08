import { useCrosshair } from "@/hooks/use-crosshair";
import { Crosshair } from "lucide-react";

/** Renders either the user's drawn crosshair or a default lucide crosshair. */
export function CustomCrosshair() {
  const { config } = useCrosshair();
  if (!config.useCustom) {
    return <Crosshair className="size-6 text-primary opacity-70" strokeWidth={1.5} />;
  }
  const px = config.scale;
  const size = config.grid * px;
  return (
    <div
      className="pointer-events-none"
      style={{
        width: size,
        height: size,
        display: "grid",
        gridTemplateColumns: `repeat(${config.grid}, ${px}px)`,
        gridTemplateRows: `repeat(${config.grid}, ${px}px)`,
      }}
      aria-hidden
    >
      {config.cells.map((on, i) => (
        <div
          key={i}
          style={{
            width: px,
            height: px,
            background: on ? config.color : "transparent",
            boxShadow: on ? `0 0 ${px}px ${config.color}` : undefined,
          }}
        />
      ))}
    </div>
  );
}