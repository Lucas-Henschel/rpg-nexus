import { readFile } from "node:fs/promises";

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(new URL(relativePath, import.meta.url), "utf8"),
  );
}

try {
  const schema = await readJson(
    "../contracts/events/event-envelope.schema.json",
  );
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const ajv = new Ajv2020({ allErrors: true });

  addFormats(ajv);

  const validate = ajv.compile(schema);
  const valid = await readJson(
    "../contracts/examples/event-envelope.valid.json",
  );
  const invalid = await readJson(
    "../contracts/examples/event-envelope.invalid.json",
  );

  if (!validate(valid)) {
    throw new Error(
      `Exemplo válido rejeitado: ${ajv.errorsText(validate.errors)}`,
    );
  }

  console.log("PASS: exemplo válido aceito.");

  if (validate(invalid)) {
    throw new Error("Exemplo inválido foi aceito pelo esquema.");
  }

  console.log(
    `PASS: exemplo inválido rejeitado: ${ajv.errorsText(validate.errors)}`,
  );
} catch (error) {
  console.error(`Falha na validação dos contratos: ${error.message}`);
  process.exitCode = 1;
}
