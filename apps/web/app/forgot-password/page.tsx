"use client";

import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    const result = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    if (result.error) {
      setError(result.error.message ?? "Could not send the reset email.");
      return;
    }
    setMessage("If that account exists, a reset link is on its way.");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold">Reset password</h1>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block text-sm">
          Email
          <input className="mt-1" name="email" type="email" required />
        </label>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {message ? <p className="text-sm">{message}</p> : null}
        <button type="submit" className="w-full rounded-full bg-pine px-4 py-2.5 text-white">
          Send reset link
        </button>
      </form>
      <Link href="/sign-in" className="mt-4 text-sm text-muted">
        Back to sign in
      </Link>
    </main>
  );
}
