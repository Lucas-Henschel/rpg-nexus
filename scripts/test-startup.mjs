import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, description, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await pause(200);
  }
  throw new Error(`Timed out: ${description}`);
}

for (const workflow of ['dev:detached', 'dev']) {
  for (const scenario of ['fast success', 'delayed success', 'failure']) {
    test(`${workflow}: ${scenario} with an initially absent bucket`, { timeout: 120000 }, async () => {
      mkdirSync(path.join(root, '.local'), { recursive: true });
      const fixture = mkdtempSync(path.join(root, '.local/startup-test-'));
      const bucket = `startup-${path.basename(fixture).toLowerCase()}`;
      const env = {
        ...process.env,
        COMPOSE_PROJECT_NAME: `rpg-${path.basename(fixture).toLowerCase()}`,
        COMPOSE_FILE: `${path.join(root, 'docker-compose.yml')}${path.delimiter}${path.join(fixture, 'compose.json')}`,
        RABBITMQ_PORT: '0', RABBITMQ_MANAGEMENT_PORT: '0', MINISTACK_PORT: '0',
        AWS_ENDPOINT_URL: 'http://ministack:4566', AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', RPG_ASSETS_BUCKET: bucket,
      };
      const initCommand = scenario === 'failure' ? 'exit 37'
        : `${scenario === 'delayed success' ? 'while [ ! -f /gate/release ]; do sleep 0.1; done; ' : ''}exec /bin/sh /work/infra/ministack/init-resources.sh`;
      writeFileSync(path.join(fixture, 'compose.json'), JSON.stringify({ services: {
        rabbitmq: { healthcheck: { interval: '1s', start_period: '0s', retries: 60 } },
        ministack: { healthcheck: { interval: '1s', start_period: '0s', retries: 60 } },
        'aws-init': { entrypoint: ['/bin/sh', '-c'], command: [initCommand],
          volumes: [`${fixture}:/gate:ro`] },
      } }));
      function docker(args, allowFailure = false) {
        const result = spawnSync('docker', args, { cwd: root, env, encoding: 'utf8', timeout: 60000 });
        if (!allowFailure) assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
        return result;
      }
      const compose = (args, allowFailure) => docker(['compose', ...args], allowFailure);
      const container = (service) => compose(['ps', '--all', '--quiet', service]).stdout.trim();
      const state = (service) => {
        const id = container(service);
        return id ? JSON.parse(docker(['inspect', id]).stdout)[0].State : undefined;
      };
      const bucketExists = () => compose(['exec', '-T', 'ministack', 'aws', '--endpoint-url',
        'http://localhost:4566', 's3api', 'head-bucket', '--bucket', bucket], true).status === 0;
      let child;
      let result;
      let output = '';
      try {
        compose(['up', '--detach', '--wait', 'ministack']);
        assert.equal(bucketExists(), false, 'test must begin without the bucket');
        child = spawn('pnpm', [workflow], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.on('data', (data) => { output += data; });
        child.stderr.on('data', (data) => { output += data; });
        child.on('close', (code, signal) => { result = { code, signal }; });

        if (scenario === 'delayed success') {
          await until(() => state('aws-init')?.Running, 'initializer running');
          await pause(3000);
          assert.equal(result, undefined, 'workflow must wait while initialization is blocked');
          assert.equal(bucketExists(), false, 'bucket must still be absent before initialization');
          assert.notEqual(state('rabbitmq')?.Running, true, 'stack readiness must wait for initialization');
          writeFileSync(path.join(fixture, 'release'), '');
        }

        await until(() => state('aws-init')?.Status === 'exited', 'initializer exit');
        if (scenario === 'failure') {
          assert.equal(state('aws-init').ExitCode, 37);
          await until(() => result !== undefined, 'workflow propagates initialization failure', 5000);
          assert.notEqual(result.code, 0, 'initialization failure must fail the public workflow');
          assert.equal(bucketExists(), false);
          assert.notEqual(state('rabbitmq')?.Running, true);
          console.log(`PASS ${workflow}: init exit=37, workflow exit=${result.code}, bucket absent`);
        } else {
          assert.equal(state('aws-init').ExitCode, 0);
          await until(() => state('rabbitmq')?.Health?.Status === 'healthy', 'RabbitMQ healthy');
          assert.equal(state('ministack').Health.Status, 'healthy');
          assert.equal(bucketExists(), true, 'successful startup must create the initially absent bucket');
          if (workflow === 'dev:detached') {
            await until(() => result !== undefined, 'detached workflow returns');
            assert.equal(result.code, 0, output);
          } else {
            assert.equal(result, undefined, 'attached workflow must keep streaming logs');
            compose(['stop']);
            await until(() => result !== undefined, 'attached workflow exits after stack stops');
            assert.equal(result.code, 0, output);
          }
          console.log(`PASS ${workflow}: ${scenario}, init exit=0, healthy infrastructure, bucket created, workflow exit=0`);
        }
      } catch (error) {
        console.error(output);
        throw error;
      } finally {
        compose(['down', '--volumes', '--remove-orphans'], true);
        if (child && result === undefined) child.kill('SIGTERM');
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  }
}
