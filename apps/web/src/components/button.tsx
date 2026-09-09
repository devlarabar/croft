import type { ComponentProps } from "react";
import { clsx } from "clsx";

type ButtonProps = ComponentProps<"button">;
type ButtonLinkProps = ComponentProps<"a">;

export function Button({ className, ...props }: ButtonProps) {
  return <button {...props} className={clsx("btn", className)} />;
}

export function ButtonLink({ className, ...props }: ButtonLinkProps) {
  return <a {...props} className={clsx("btn", className)} />;
}
