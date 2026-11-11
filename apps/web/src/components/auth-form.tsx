"use client";

import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "");
    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "That didn't work.");
      return;
    }
    router.push("/agents");
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      {mode === "sign-up" ? (
        <label className="block text-sm">
          Name
          <input className="mt-1" name="name" required autoComplete="name" />
        </label>
      ) : null}
      <label className="block text-sm">
        Email
        <input className="mt-1" name="email" type="email" required autoComplete="email" />
      </label>
      <label className="block text-sm">
        Password
        <input
          className="mt-1"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
        />
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-pine px-4 py-2.5 text-white disabled:opacity-60"
      >
        {mode === "sign-up" ? "Create account" : "Sign in"}
      </button>
      <p className="text-sm text-muted">
        {mode === "sign-up" ? (
          <Link href="/sign-in">Already have an account? Sign in</Link>
        ) : (
          <>
            <Link href="/sign-up">Create an account</Link>
            <span> · </span>
            <Link href="/forgot-password">Forgot password</Link>
          </>
        )}
      </p>
    </form>
  );
}
