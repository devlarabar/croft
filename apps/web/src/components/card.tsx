import type { ComponentProps } from "react";
import { clsx } from "clsx";

type CardProps = ComponentProps<"div">;

export function Card({ className, ...props }: CardProps) {
  return <div {...props} className={clsx("card", className)} />;
}
