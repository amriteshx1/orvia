"use client";

import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-sm text-muted"
      onClick={() => {
        void authClient.signOut().then(() => {
          router.push("/");
        });
      }}
    >
      Sign out
    </button>
  );
}
