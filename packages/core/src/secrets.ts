import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type SecretPayload = {
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  headers?: Record<string, string>;
};

export function parseEncryptionKey(hex: string | undefined): Buffer | null {
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Buffer.from(hex, "hex");
}

export function encryptJson(payload: SecretPayload, key: Buffer): { ciphertext: string; iv: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptJson(
  row: { ciphertext: string; iv: string; authTag: string },
  key: Buffer,
): SecretPayload {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(row.iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const parsed = JSON.parse(plaintext) as SecretPayload;
  return parsed && typeof parsed === "object" ? parsed : {};
}
