import nodemailer from "nodemailer";
import { getWebEnv } from "@orvia/config";

export async function deliverMail(message: { to: string; subject: string; text: string }): Promise<void> {
  const env = getWebEnv();
  if (!env.smtpHost) {
    if (env.NODE_ENV === "production") {
      throw new Error("SMTP is not configured");
    }
    console.info(`[mail] To: ${message.to}\nSubject: ${message.subject}\n${message.text}`);
    return;
  }

  const transport = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    auth:
      env.smtpUser && env.smtpPassword
        ? { user: env.smtpUser, pass: env.smtpPassword }
        : undefined,
  });

  await transport.sendMail({
    from: env.emailFrom,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
}
