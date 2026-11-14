#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

# Read Compose's resolved values rather than treating .env as shell code.
exec node <<'NODE'
const { spawnSync } = require('node:child_process');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout;
}

const config = JSON.parse(run('docker', ['compose', 'config', '--format', 'json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
}));
const { rabbitmq, ministack, 'aws-init': awsInit } = config.services;
const publishedPort = (service, target) => {
  const port = service.ports.find((port) => Number(port.target) === target)?.published;
  if (!port) throw new Error(`Compose does not publish port ${target}`);
  return port;
};
const endpoint = `http://localhost:${publishedPort(ministack, 4566)}`;
const env = awsInit.environment;

console.log('Checking RabbitMQ health through the published host port...');
run('curl', [
  '--fail', '--silent', '--show-error', '--max-time', '10',
  '--user', `${rabbitmq.environment.RABBITMQ_DEFAULT_USER}:${rabbitmq.environment.RABBITMQ_DEFAULT_PASS}`,
  `http://localhost:${publishedPort(rabbitmq, 15672)}/api/health/checks/alarms`,
]);
console.log(`\nChecking S3 and DynamoDB at ${endpoint}...`);
const awsArgs = [
  'run', '--rm', '--network', 'host',
  '--env', `AWS_ACCESS_KEY_ID=${env.AWS_ACCESS_KEY_ID}`,
  '--env', `AWS_SECRET_ACCESS_KEY=${env.AWS_SECRET_ACCESS_KEY}`,
  '--env', 'AWS_EC2_METADATA_DISABLED=true',
  '--env', 'AWS_MAX_ATTEMPTS=1',
  '--env', 'AWS_PAGER=',
  awsInit.image,
  '--endpoint-url', endpoint, '--region', env.AWS_REGION,
  '--cli-connect-timeout', '5', '--cli-read-timeout', '10',
];
run('docker', [...awsArgs, 's3api', 'head-bucket', '--bucket', env.RPG_ASSETS_BUCKET]);
run('docker', [...awsArgs, 'dynamodb', 'list-tables']);
console.log(`PASS: RabbitMQ, S3 bucket ${env.RPG_ASSETS_BUCKET}, and DynamoDB are reachable from the host.`);
NODE
