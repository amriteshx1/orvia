"use client";

import { authClient } from "@/lib/auth-client";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function ResetForm() {
  const token = useSearchParams().get("token");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError("This reset link is missing a token.");
      return;
    }
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const result = await authClient.resetPassword({ newPassword: password, token });
    if (result.error) {
      setError(result.error.message ?? "Could not reset the password.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <a href="/sign-in" className="mt-6 inline-block text-pine">
        Password updated. Sign in
      </a>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      <label className="block text-sm">
        New password
        <input className="mt-1" name="password" type="password" minLength={8} required />
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <button type="submit" className="w-full rounded-full bg-pine px-4 py-2.5 text-white">
        Update password
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold">Choose a new password</h1>
      <Suspense>
        <ResetForm />
      </Suspense>
    </main>
  );
}
