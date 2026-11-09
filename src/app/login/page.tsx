import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { authenticateAction } from "@/lib/auth-actions";
import { AuthForm } from "@/components/AuthForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return <AuthForm action={authenticateAction} />;
}
