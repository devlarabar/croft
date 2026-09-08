import type { ComponentProps } from "react";
import { clsx } from "clsx";

type ButtonProps = ComponentProps<"button">;

export function Button({ className, ...props }: ButtonProps) {
  return <button {...props} className={clsx("btn", className)} />;
}
