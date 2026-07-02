import { BookOpen, Ear, Feather, MessageCircle, type LucideIcon } from "lucide-react";

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
  beginner: { color: "coral", icon: Feather },
  elementary: { color: "violet", icon: MessageCircle },
  "pre-intermediate": { color: "blue", icon: BookOpen },
  intermediate: { color: "mint", icon: Ear },
};
