import Link from "next/link";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6">
        <p className="text-sm text-muted">Signed in as {user.email}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Your workspace is ready.</h1>
        <Link
          href="/agents"
          className="mt-8 inline-flex w-fit rounded-full bg-pine px-5 py-2.5 text-white"
        >
          Open agents
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6">
      <p className="text-sm font-medium text-pine">Orvia</p>
      <h1 className="mt-3 max-w-xl text-5xl font-semibold tracking-tight">
        Agents you can define, watch, and stop.
      </h1>
      <p className="mt-4 max-w-xl text-lg text-muted">
        Create an agent, give it instructions, and keep every configuration change as a version.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/sign-up" className="rounded-full bg-pine px-5 py-2.5 text-white">
          Create account
        </Link>
        <Link href="/sign-in" className="rounded-full border border-line px-5 py-2.5">
          Sign in
        </Link>
      </div>
    </main>
  );
}
