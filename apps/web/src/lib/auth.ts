import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { getWebEnv } from "@orvia/config";
import { prisma } from "@orvia/db";
import { deliverMail } from "./mail";

const env = getWebEnv();

function trustedOrigins(): string[] {
  const origins = new Set([env.appUrl]);
  if (env.NODE_ENV === "production") return [...origins];
  for (const origin of [...origins]) {
    const url = new URL(origin);
    if (url.hostname === "localhost") url.hostname = "127.0.0.1";
    else if (url.hostname === "127.0.0.1") url.hostname = "localhost";
    else continue;
    origins.add(url.origin);
  }
  return [...origins];
}

export const auth = betterAuth({
  baseURL: env.betterAuthUrl,
  secret: env.betterAuthSecret,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  trustedOrigins: trustedOrigins(),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: env.emailVerificationRequired,
    revokeSessionsOnPasswordReset: true,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url, token }) => {
      const resetUrl = token
        ? `${env.appUrl}/reset-password?token=${encodeURIComponent(token)}`
        : url;
      await deliverMail({
        to: user.email,
        subject: "Reset your Orvia password",
        text: `Reset your password: ${resetUrl}`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: env.emailVerificationRequired,
    sendVerificationEmail: async ({ user, url }) => {
      await deliverMail({
        to: user.email,
        subject: "Verify your Orvia email",
        text: `Verify your email: ${url}`,
      });
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": {
        window: 60,
        max: 3,
      },
    },
  },
});
