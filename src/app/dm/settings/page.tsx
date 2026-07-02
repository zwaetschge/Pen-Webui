import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { SettingsForm } from "./_components/SettingsForm";

export const dynamic = "force-dynamic";

export default async function DMSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  if (!user.isDM) redirect("/campaigns");

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <p className="font-display text-xs uppercase tracking-[0.3em] text-brass-400">
          DM Settings
        </p>
        <h1 className="font-display text-3xl text-parchment-100">
          Behind the screen
        </h1>
      </header>
      <SettingsForm />
    </main>
  );
}
