// Confere os contratos de eventos e a topologia do RabbitMQ que entrega cada um deles.
//
// 1. Cada events/<nome>.schema.json aceita examples/<nome>.valid.json e recusa
//    examples/<nome>.invalid.json.
// 2. Cada routing key de um esquema chega a pelo menos uma fila em infra/rabbitmq/definitions.json,
//    e as filas citadas em x-routing.consumers existem e recebem essa routing key.
// 3. Toda ligação do definitions.json corresponde a um evento com esquema.
// 4. Toda fila de consumo tem .retry e .dlq, com os argumentos que os serviços declaram.
// 5. As filas dos manifestos (infra/manifests/*.json) estão no definitions.json com os mesmos
//    argumentos e ligações; senão o serviço que as declara é recusado pelo RabbitMQ.
import { readdir, readFile } from "node:fs/promises";

const EXCHANGE = "rpg.events";
const failures = [];
const pass = (message) => console.log(`PASS: ${message}`);
const fail = (message) => failures.push(message);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}

async function listJson(relativeDir) {
  const names = await readdir(new URL(relativeDir, import.meta.url));
  return names.filter((name) => name.endsWith(".json")).sort();
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

try {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { default: addFormats } = await import("ajv-formats");
  const ajv = new Ajv2020({ allErrors: true });

  addFormats(ajv);
  // Documenta exchange, routing key, produtor e consumidores; não valida nada na mensagem.
  ajv.addKeyword("x-routing");
  ajv.addSchema(await readJson("./envelope.schema.json"));

  const schemas = [];

  for (const file of await listJson("./events/")) {
    const schema = await readJson(`./events/${file}`);
    ajv.addSchema(schema);
    schemas.push({ name: file.replace(".schema.json", ""), schema });
  }

  // 1. exemplos
  const examples = new Set(await listJson("./examples/"));

  for (const { name, schema } of schemas) {
    const validate = ajv.getSchema(schema.$id);

    for (const kind of ["valid", "invalid"]) {
      const file = `${name}.${kind}.json`;

      if (!examples.delete(file)) {
        fail(`${name}: falta examples/${file}`);
        continue;
      }

      const accepted = validate(await readJson(`./examples/${file}`));

      if (kind === "valid" && !accepted) {
        fail(`${file} foi recusado: ${ajv.errorsText(validate.errors)}`);
      } else if (kind === "invalid" && accepted) {
        fail(`${file} foi aceito`);
      }
    }
  }

  pass(`${schemas.length} esquemas aceitam o exemplo válido e recusam o inválido`);

  // Exemplos de versão desconhecida: o envelope aceita, o esquema da v1 do mesmo evento recusa.
  for (const file of [...examples]) {
    const match = /^(.+)\.v\d+\.unknown-version\.json$/.exec(file);

    if (!match) {
      continue;
    }

    examples.delete(file);
    const document = await readJson(`./examples/${file}`);
    const v1 = schemas.find((s) => s.name === `${match[1]}.v1`);

    if (!ajv.getSchema("urn:rpg-nexus:envelope:v1")(document)) {
      fail(`${file}: o envelope deveria aceitar uma versão desconhecida`);
    } else if (!v1 || ajv.getSchema(v1.schema.$id)(document)) {
      fail(`${file}: o esquema ${match[1]}.v1 deveria recusar`);
    } else {
      pass(`${file} passa no envelope e é recusado pela v1`);
    }
  }

  for (const file of examples) {
    fail(`examples/${file} não pertence a nenhum esquema`);
  }

  // 2 e 3. esquemas × definitions.json
  const definitions = await readJson("../infra/rabbitmq/definitions.json");
  const bound = new Map(); // routing key -> filas

  for (const b of definitions.bindings) {
    if (b.source !== EXCHANGE) {
      fail(`binding de ${b.source}: tudo deve passar por ${EXCHANGE}`);
    }

    bound.set(b.routing_key, [...(bound.get(b.routing_key) ?? []), b.destination]);
  }

  const routingKeys = new Set();

  for (const { name, schema } of schemas) {
    const { exchange, routingKey, consumers } = schema["x-routing"];
    routingKeys.add(routingKey);

    if (exchange !== EXCHANGE) {
      fail(`${name}: exchange ${exchange}, esperado ${EXCHANGE}`);
    }

    const queues = bound.get(routingKey) ?? [];

    if (queues.length === 0) {
      fail(`${name}: nenhuma fila recebe ${routingKey}`);
    }

    for (const consumer of consumers) {
      const queue = /fila ([\w.-]+)/.exec(consumer)?.[1];

      if (!queue) {
        fail(`${name}: consumidor sem fila em x-routing ("${consumer}")`);
      } else if (!queues.includes(queue)) {
        fail(`${name}: a fila ${queue} não recebe ${routingKey}`);
      }
    }
  }

  for (const key of bound.keys()) {
    if (!routingKeys.has(key)) {
      fail(`definitions.json liga ${key}, que não tem esquema`);
    }
  }

  pass(`${routingKeys.size} routing keys chegam às filas dos consumidores declarados`);

  // 4. .retry e .dlq
  const queuesByName = new Map(definitions.queues.map((q) => [q.name, q]));
  const consumerQueues = [...queuesByName.keys()].filter((n) => !/\.(retry|dlq)$/.test(n));

  for (const name of consumerQueues) {
    const expected = [
      [name, { "x-dead-letter-exchange": "", "x-dead-letter-routing-key": `${name}.dlq` }],
      [`${name}.retry`, { "x-dead-letter-exchange": "", "x-dead-letter-routing-key": name }],
      [`${name}.dlq`, {}],
    ];

    for (const [queueName, args] of expected) {
      const queue = queuesByName.get(queueName);

      if (!queue) {
        fail(`falta a fila ${queueName}`);
      } else if (!queue.durable || !sameJson(queue.arguments, args)) {
        fail(`${queueName}: esperado durável com argumentos ${JSON.stringify(args)}`);
      }
    }
  }

  pass(`${consumerQueues.length} filas de consumo com .retry e .dlq`);

  // 5. manifestos dos serviços
  for (const file of await listJson("../infra/manifests/")) {
    const manifest = await readJson(`../infra/manifests/${file}`);

    for (const q of manifest.rabbitmq?.queues ?? []) {
      const queue = queuesByName.get(q.name);
      const keys = definitions.bindings
        .filter((b) => b.destination === q.name)
        .map((b) => b.routing_key);

      if (!queue) {
        fail(`${file}: a fila ${q.name} não está no definitions.json`);
      } else if (!sameJson(queue.arguments, q.arguments)) {
        fail(`${file}: ${q.name} tem argumentos diferentes no definitions.json`);
      } else if (!sameJson([...keys].sort(), [...q.bindings].sort())) {
        fail(`${file}: ${q.name} recebe ${keys} no definitions.json, ${q.bindings} no manifesto`);
      }
    }

    pass(`filas de ${file} iguais às do definitions.json`);
  }
} catch (error) {
  fail(error.message);
}

if (failures.length > 0) {
  console.error(`Falha na validação dos contratos:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
}
