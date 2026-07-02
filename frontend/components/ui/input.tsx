import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(
      "h-12 w-full rounded-xl border border-line bg-canvas px-4 text-sm text-ink outline-none transition placeholder:text-muted/60 focus:border-brand focus:ring-4 focus:ring-indigo-500/10",
      className,
    )} {...props} />
  ),
);
Input.displayName = "Input";
