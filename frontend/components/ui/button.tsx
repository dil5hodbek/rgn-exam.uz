import * as React from "react";
import { cn } from "@/lib/utils";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
};

export const Button = React.forwardRef<HTMLButtonElement, Props>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" && "bg-brand text-white shadow-lg shadow-indigo-500/20 hover:-translate-y-0.5 hover:bg-indigo-600",
        variant === "secondary" && "border border-line bg-canvas text-ink hover:bg-surface",
        variant === "ghost" && "text-muted hover:bg-surface hover:text-ink",
        variant === "danger" && "bg-red-500 text-white hover:bg-red-600",
        size === "sm" && "h-9 px-3 text-sm",
        size === "md" && "h-11 px-5 text-sm",
        size === "lg" && "h-12 px-6",
        size === "icon" && "h-10 w-10",
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
