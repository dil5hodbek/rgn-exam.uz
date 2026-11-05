import { AppShell } from "@/components/app-shell";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const sessionCookies = cookies();
  if (!sessionCookies.get("access_token")?.value && !sessionCookies.get("refresh_token")?.value) {
    redirect("/sign-in");
  }
  return <AppShell>{children}</AppShell>;
}
