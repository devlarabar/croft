import type { ReactNode } from "react";

interface FieldsetProps {
  legend: ReactNode;
  children: ReactNode;
}

export function Fieldset({ legend, children }: FieldsetProps) {
  return <fieldset><legend>{legend}</legend>{children}</fieldset>;
}
