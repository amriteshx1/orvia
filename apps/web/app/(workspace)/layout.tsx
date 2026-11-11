import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/agents" className="font-semibold">
              Orvia
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/agents">Agents</Link>
              <Link href="/executions">Executions</Link>
              <Link href="/approvals">Approvals</Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
    </div>
  );
}
