import { Sprout, Leaf, Rocket, GraduationCap, Trophy, type LucideIcon } from "lucide-react";

export type LevelCardData = {
  name: string;
  slug: string;
  description: string;
  progress: number;
  completed: number;
  total: number;
  // Best score among finished tests of this level, and whether any test was opened.
  best?: number | null;
  started?: boolean;
  color: "coral" | "violet" | "blue" | "mint" | "gold";
  icon: LucideIcon;
};

export const levelVisuals: Record<string, Pick<LevelCardData, "color" | "icon">> = {
  beginner: { color: "coral", icon: Sprout },
  elementary: { color: "violet", icon: Leaf },
  "pre-intermediate": { color: "blue", icon: Rocket },
  intermediate: { color: "mint", icon: GraduationCap },
  advanced: { color: "gold", icon: Trophy },
};
