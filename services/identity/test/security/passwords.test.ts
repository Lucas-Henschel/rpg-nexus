import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config.js";
import { createPasswordHasher } from "../../src/security/passwords.js";

describe("password hasher", () => {
  it("usa salt aleatório e valida apenas a senha correta", async () => {
    const passwords = createPasswordHasher(loadEnv({ PASSWORD_SCRYPT_N: "1024" }));
    const first = await passwords.hash("senha-segura-123");
    const second = await passwords.hash("senha-segura-123");

    expect(first).toMatch(/^scrypt\$1024\$8\$1\$/);
    expect(second).not.toBe(first);
    await expect(passwords.verify("senha-segura-123", first)).resolves.toBe(true);
    await expect(passwords.verify("outra-senha", first)).resolves.toBe(false);
    await expect(passwords.verify("qualquer", "inválido")).resolves.toBe(false);
  });
});
