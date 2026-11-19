import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import type { Env } from "../config.js";

const KEY_LENGTH = 64;

function scrypt(password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, keyLength, { ...options, maxmem: Math.max(32 * 1024 * 1024, 256 * options.N * options.r) }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<boolean>;
}

export function createPasswordHasher(env: Env): PasswordHasher {
  const params = { N: env.PASSWORD_SCRYPT_N, r: env.PASSWORD_SCRYPT_R, p: env.PASSWORD_SCRYPT_P };

  return {
    async hash(password) {
      const salt = randomBytes(16);
      const derived = await scrypt(password, salt, KEY_LENGTH, params);

      return ["scrypt", params.N, params.r, params.p, salt.toString("base64url"), derived.toString("base64url")].join("$");
    },

    async verify(password, encodedHash) {
      const [algorithm, n, r, p, encodedSalt, encodedKey] = encodedHash.split("$");
      if (algorithm !== "scrypt" || !n || !r || !p || !encodedSalt || !encodedKey) return false;

      const expected = Buffer.from(encodedKey, "base64url");
      const actual = await scrypt(password, Buffer.from(encodedSalt, "base64url"), expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
      }).catch(() => null);

      return actual !== null && actual.length === expected.length && timingSafeEqual(actual, expected);
    },
  };
}
