import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildLarkSlashCommandManifest,
  buildLarkSlashCommandCliArgs,
  compareLarkSlashCommands,
  LARK_SLASH_COMMAND_PROVISIONING_SCOPES,
  normalizeLarkSlashCommandList,
  planLarkSlashCommandSync,
  verifyLarkSlashCommandProvisioningScopes,
} from '../src/lark-slash-commands.js';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const syncScript = fileURLToPath(new URL('../scripts/sync-lark-slash-commands.mjs', import.meta.url));

test('Lark slash-command manifest renders the shared command surface with a provider prefix', () => {
  const manifest = buildLarkSlashCommandManifest({ slashPrefix: 'cx' });

  assert.equal(manifest.length, 46);
  assert.equal(manifest.some((item) => item.command === 'cx_status'), true);
  assert.equal(manifest.some((item) => item.command === 'cx_abort'), true);
  assert.equal(manifest.some((item) => item.command === 'cx_pi_sessions'), true);
  assert.equal(manifest.some((item) => item.command === 'cx_omp_resume'), true);
  assert.equal(manifest.every((item) => item.command.length <= 64), true);
  assert.equal(manifest.every((item) => item.description.length <= 100), true);
});

test('Lark slash-command drift comparison distinguishes missing, outdated, and extra entries', () => {
  const desired = [
    { command: 'cx_status', description: 'Status' },
    { command: 'cx_settings', description: 'Settings' },
  ];
  const actual = normalizeLarkSlashCommandList({
    data: {
      items: [
        { command_id: 'cmd_private_1', command: 'cx_status', description: { default_value: 'Old' } },
        { command_id: 'cmd_private_2', command: 'custom', description: { default_value: 'Custom' } },
      ],
    },
  });
  const diff = compareLarkSlashCommands(desired, actual);

  assert.equal(diff.ok, false);
  assert.deepEqual(diff.missing, [{ command: 'cx_settings', description: 'Settings' }]);
  assert.deepEqual(diff.outdated, [{
    command: 'cx_status',
    description: 'Status',
    commandId: 'cmd_private_1',
  }]);
  assert.deepEqual(diff.extra, [{ command: 'custom', description: 'Custom' }]);
});

test('Lark slash-command list rejects ambiguous empty response shapes', () => {
  assert.throws(
    () => normalizeLarkSlashCommandList({ data: {} }),
    /returned no command list/,
  );
});

test('Lark slash-command provisioning scope check distinguishes read and write grants', () => {
  const baseline = verifyLarkSlashCommandProvisioningScopes({
    data: {
      scopes: [
        {
          scope_type: 'tenant',
          scope_name: LARK_SLASH_COMMAND_PROVISIONING_SCOPES[0],
          grant_status: 1,
        },
        {
          scope_type: 'tenant',
          scope_name: LARK_SLASH_COMMAND_PROVISIONING_SCOPES[1],
          grant_status: 0,
        },
        {
          scope_type: 'user',
          scope_name: LARK_SLASH_COMMAND_PROVISIONING_SCOPES[1],
          grant_status: 1,
        },
      ],
    },
  });

  assert.deepEqual(baseline, {
    ok: false,
    requiredCount: 2,
    grantedCount: 1,
    missing: ['application:app_slash_command:write'],
  });
});

test('Lark slash-command sync plan separates creates from updates without exposing command ids', () => {
  const plan = planLarkSlashCommandSync({
    installedCount: 2,
    missing: [{ command: 'cx_settings', description: 'Settings' }],
    outdated: [{ command: 'cx_status', description: 'Status', commandId: 'cmd_private_1' }],
  });

  assert.equal(plan.capacityOk, true);
  assert.equal(plan.availableSlots, 98);
  assert.equal(plan.operationCount, 2);
  assert.deepEqual(plan.operations, [
    { type: 'create', command: 'cx_settings', description: 'Settings' },
    { type: 'update', command: 'cx_status', description: 'Status' },
  ]);
  assert.equal(JSON.stringify(plan).includes('cmd_private_1'), false);
});

test('Lark slash-command sync plan refuses writes that exceed registry capacity', () => {
  const plan = planLarkSlashCommandSync({
    installedCount: 99,
    missing: [
      { command: 'cx_status', description: 'Status' },
      { command: 'cx_settings', description: 'Settings' },
    ],
    outdated: [],
  });

  assert.equal(plan.capacityOk, false);
  assert.equal(plan.availableSlots, 1);
  assert.equal(plan.requiredCreateCount, 2);
});

test('Lark slash-command CLI operations use create for missing and update for outdated commands', () => {
  assert.deepEqual(buildLarkSlashCommandCliArgs({
    type: 'create',
    command: 'cx_settings',
    description: 'Settings',
  }), [
    'application', '+slash-command-create',
    '--command', 'cx_settings',
    '--description', 'Settings',
    '--force',
    '--as', 'bot',
    '--json',
  ]);
  assert.deepEqual(buildLarkSlashCommandCliArgs({
    type: 'update',
    command: 'cx_status',
    description: 'Status',
  }), [
    'application', '+slash-command-update',
    '--command', 'cx_status',
    '--description', 'Status',
    '--as', 'bot',
    '--json',
  ]);
  assert.deepEqual(buildLarkSlashCommandCliArgs({
    type: 'update',
    command: 'cx_status',
    description: 'Status',
  }, { dryRun: true }), [
    'application', '+slash-command-update',
    '--command', 'cx_status',
    '--description', 'Status',
    '--as', 'bot',
    '--json',
    '--dry-run',
  ]);
});

test('Lark slash-command sync never validates or writes pending changes without the write scope', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aid-lark-slash-scope-'));
  const fakeCli = path.join(tempDir, 'fake-lark-cli.mjs');
  const writeMarker = path.join(tempDir, 'write-called');
  fs.writeFileSync(fakeCli, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('/open-apis/application/v6/scopes')) {
  console.log(JSON.stringify({ code: 0, data: { scopes: [{
    scope_type: 'tenant',
    scope_name: 'application:app_slash_command:read',
    grant_status: 1,
  }] } }));
} else if (args.includes('+slash-command-list')) {
  console.log(JSON.stringify({ data: { items: [] } }));
} else if (args.includes('+slash-command-create') || args.includes('+slash-command-update')) {
  fs.appendFileSync(process.env.FAKE_LARK_WRITE_MARKER, args.join(' '));
  console.log('{}');
} else {
  process.exitCode = 2;
}
`);
  fs.chmodSync(fakeCli, 0o755);
  const env = {
    ...process.env,
    BOT_PROVIDER: 'codex',
    LARK_TRANSPORT: 'cli',
    LARK_CLI_BIN: fakeCli,
    FAKE_LARK_WRITE_MARKER: writeMarker,
    SLASH_PREFIX: 'cx',
  };

  try {
    for (const mode of ['--dry-run', '--apply']) {
      const result = spawnSync(process.execPath, [syncScript, mode, '--json'], {
        cwd: rootDir,
        env,
        encoding: 'utf8',
      });
      assert.equal(result.status, 1);
      const report = JSON.parse(result.stdout);
      assert.equal(report.provisioningScopes.readAvailable, true);
      assert.equal(report.provisioningScopes.writeAvailable, false);
      assert.equal(report.requiresWriteScope, true);
      assert.equal(report.validatedCount, 0);
      assert.equal(report.appliedCount, 0);
      assert.equal(fs.existsSync(writeMarker), false);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
