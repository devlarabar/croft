import type { ReactNode } from "react";
import { clsx } from "clsx";

interface FieldsetProps {
  legend: ReactNode;
  children: ReactNode;
  description?: string;
  annotation?: ReactNode;
  danger?: boolean;
}

export function Fieldset({ legend, children, description, annotation, danger }: FieldsetProps) {
  return <fieldset className={clsx({ "danger-card": danger })}><legend><span>{legend}</span>{annotation ? <span className="caption">{annotation}</span> : null}</legend>{description ? <p>{description}</p> : null}{children}</fieldset>;
}
