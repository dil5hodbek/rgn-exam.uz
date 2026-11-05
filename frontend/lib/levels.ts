import { Sprout, Leaf, Rocket, GraduationCap, type LucideIcon } from "lucide-react";

export type LevelCardData = {
  name: string;
  slug: string;
  description: string;
  progress: number;
  completed: number;
  total: number;
  color: "coral" | "violet" | "blue" | "mint";
  icon: LucideIcon;
};

export const levelVisuals: Record<string, Pick<LevelCardData, "color" | "icon">> = {
  beginner: { color: "coral", icon: Sprout },
  elementary: { color: "violet", icon: Leaf },
  "pre-intermediate": { color: "blue", icon: Rocket },
  intermediate: { color: "mint", icon: GraduationCap },
};
