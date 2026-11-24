import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { authenticateAction } from "@/lib/auth-actions";
import { AuthForm } from "@/components/AuthForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ intent?: string }> }) {
  if (await getCurrentUser()) redirect("/bots");
  const { intent } = await searchParams;
  return <AuthForm action={authenticateAction} initialMode={intent === "signup" ? "signup" : "signin"} />;
}
