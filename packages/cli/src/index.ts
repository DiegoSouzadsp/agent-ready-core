#!/usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';
import { AgentReady } from '@agent-ready/core';
import fs from 'node:fs';
import path from 'node:path';
import { INIT_TEMPLATE } from './init-template.js';
import { importOpenApi, OpenApiImportError } from './openapi-init.js';
import { buildHookScript, buildSettingsSnippet, HOOK_DOC_URL, type HookOp } from './hooks-export.js';

const program = new Command();

program
  .name('ars')
  .description('Agent-Ready Schema CLI — Governance layer for AI agents')
  .version('0.2.0');

// ─────────────────────────────────────────────
// Command: validate
// ─────────────────────────────────────────────

program
  .command('validate')
  .description('Validate a schema file for syntax and logical errors')
  .argument('<file>', 'path to the schema YAML file')
  .action(async (file: string) => {
    try {
      const fullPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(fullPath)) {
        console.error(pc.red(`\n❌ Error: File not found: ${file}`));
        process.exit(1);
      }

      console.log(pc.cyan(`\n🔍 Validating schema: ${file}...`));
      
      const agent = await AgentReady.fromFile(fullPath);
      
      console.log(pc.green(`\n✅ Schema is valid!`));
      console.log(`Module: ${pc.bold(agent.schema.module)}`);
      console.log(`Operations: ${pc.bold(agent.operations.length)}`);
      
    } catch (err: any) {
      console.error(pc.red(`\n❌ Schema Validation Error in: ${file}\n`));
      
      const message = err.message;
      
      if (message.includes('Missing required field')) {
        const field = message.split('Missing required field: ')[1];
        console.log(`Issue: The field '${pc.yellow(field)}' is required.`);
        console.log(`Fix: Add '${field}' to your YAML schema.`);
      } else {
        console.log(`Issue: ${message}`);
        console.log(`Fix: Correct the YAML file based on the message above.`);
      }
      
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────
// Command: list
// ─────────────────────────────────────────────

program
  .command('list')
  .description('List all operations available in a schema')
  .argument('<file>', 'path to the schema YAML file')
  .action(async (file: string) => {
    try {
      const fullPath = path.resolve(process.cwd(), file);
      const agent = await AgentReady.fromFile(fullPath);

      console.log(pc.cyan(`\n📋 Operations in module '${agent.schema.module}':\n`));
      
      const ops = agent.allOperations;
      
      const idLen = Math.max(...ops.map(o => o.id.length), 4);
      const nameLen = Math.max(...ops.map(o => o.name.length), 4);
      
      console.log(
        pc.bold('ID'.padEnd(idLen)) + ' | ' +
        pc.bold('Name'.padEnd(nameLen)) + ' | ' +
        pc.bold('Risk Level')
      );
      console.log('-'.repeat(idLen + nameLen + 20));
      
      for (const op of ops) {
        const handle = agent.operation(op.id);
        const risk = handle.riskLabel('en');
        
        console.log(
          op.id.padEnd(idLen) + ' | ' +
          op.name.padEnd(nameLen) + ' | ' +
          risk
        );
      }
      console.log('');
      
    } catch (err: any) {
      console.error(pc.red(`\n❌ Failed to read schema: ${err.message}`));
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────
// Command: risk
// ─────────────────────────────────────────────

program
  .command('risk')
  .description('Print the Risk Matrix for a schema')
  .argument('<file>', 'path to the schema YAML file')
  .action(async (file: string) => {
    try {
      const fullPath = path.resolve(process.cwd(), file);
      const agent = await AgentReady.fromFile(fullPath);
      const matrix = agent.riskMatrix;

      console.log(pc.cyan(`\n🛡️ Autonomy Matrix (${agent.schema.module})\n`));
      
      let currentLevel = '';
      
      for (const entry of matrix) {
        const levelStr = `${entry.assessment.emoji} ${entry.assessment.level.toUpperCase()}`;
        if (currentLevel !== levelStr) {
          currentLevel = levelStr;
          console.log(pc.bold(`\n${currentLevel}`));
          console.log(pc.gray(entry.assessment.description));
        }
        
        console.log(`  - ${entry.name}`);
      }
      console.log('');
      
    } catch (err: any) {
      console.error(pc.red(`\n❌ Failed to generate risk matrix: ${err.message}`));
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────
// Command: test
// ─────────────────────────────────────────────

program
  .command('test')
  .description('Locally test an operation validation logic without an agent')
  .argument('<file>', 'path to the schema YAML file')
  .argument('<operation>', 'name or id of the operation')
  .option('-i, --input <json>', 'JSON string of the input fields to test', '{}')
  .action(async (file: string, operation: string, options: { input: string }) => {
    try {
      const fullPath = path.resolve(process.cwd(), file);
      const agent = await AgentReady.fromFile(fullPath);
      
      const op = agent.find(operation);
      if (!op) {
        console.error(pc.red(`\n❌ Operation '${operation}' not found in schema.`));
        process.exit(1);
      }

      console.log(pc.cyan(`\n🧪 Testing operation: ${op.definition.name} (${op.riskLabel('en')})`));
      
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(options.input);
      } catch (e) {
        console.error(pc.red(`\n❌ The --input argument is not a valid JSON string.`));
        process.exit(1);
      }

      console.log(pc.gray(`Input: ${JSON.stringify(payload, null, 2)}\n`));

      const input = op.applyDefaults(payload);
      const result = op.validate(input);

      if (!result.valid) {
        console.log(pc.red('❌ Validation Failed'));
        const sp = op.signpost('validation_error', { errors: result.errors });
        
        console.log(pc.bold('\nSignpost Result:'));
        console.log(`Reason: ${pc.yellow(sp.reason!)}`);
        console.log(`What to do: ${pc.yellow(sp.what_to_do!)}`);
        
        console.log('\nErrors:');
        for (const err of sp.errors!) {
          console.log(`  - [${pc.red(err.field)}] (${err.code}) ${err.message}`);
        }
      } else if (result.needsHumanConfirmation) {
        console.log(pc.yellow('⚠️ Requires Human Confirmation'));
        for (const reason of result.confirmationReasons) {
          console.log(`  - ${reason}`);
        }
      } else {
        console.log(pc.green('✅ Validation Passed!'));
        console.log(pc.gray('Ready to be executed (or passed to state_guards) by the Agent.'));
      }
      console.log('');
      
    } catch (err: any) {
      console.error(pc.red(`\n❌ Error: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Create a starter agent-ready.yml, or generate one from an OpenAPI 3.x spec')
  .argument('[dir]', 'target directory', '.')
  .option('--force', 'overwrite an existing agent-ready.yml')
  .option('--from-openapi <source>', 'generate from an OpenAPI 3.x file (.json/.yaml/.yml) or http(s) URL')
  .action(async (dir: string, opts: { force?: boolean; fromOpenapi?: string }) => {
    try {
      const target = path.resolve(process.cwd(), dir, 'agent-ready.yml');
      if (fs.existsSync(target) && !opts.force) {
        console.error(pc.red(`
❌ ${target} already exists. Use --force to overwrite.`));
        process.exit(1);
      }
      let content = INIT_TEMPLATE;
      if (opts.fromOpenapi) {
        try {
          const result = await importOpenApi(opts.fromOpenapi);
          content = result.yaml;
          for (const w of result.warnings) console.error(pc.yellow(`⚠ ${w}`));
        } catch (err: any) {
          if (err instanceof OpenApiImportError) {
            console.error(pc.red('\n❌ Could not convert the OpenAPI spec:'));
            for (const p of err.problems) console.error(pc.red(`  - ${p}`));
            process.exit(1);
          }
          throw err;
        }
      } else {
        try {
          AgentReady.fromYAML(INIT_TEMPLATE);
        } catch (err: any) {
          console.error(pc.red(`
❌ Generated template is invalid: ${err.message}`));
          process.exit(1);
        }
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf8');
      console.log(pc.green(`
✅ Created ${target}`));
      console.log(`Next: ars validate ${target}`);
    } catch (err: any) {
      console.error(pc.red(`
❌ Error: ${err.message}`));
      process.exit(1);
    }
  });

const hooks = program.command('hooks').description('Export enforcement hooks for agent clients');

hooks
  .command('export')
  .description('Generate a PreToolUse hook (script + settings snippet) from a schema')
  .argument('<schema>', 'path to the schema YAML file')
  .requiredOption('--target <target>', 'client to export for (claude-code)')
  .option('--server <name>', 'MCP server name as registered in the client', 'agent-ready')
  .option('--out <dir>', 'output directory', '.')
  .action(async (schema: string, opts: { target: string; server: string; out: string }) => {
    try {
      if (opts.target !== 'claude-code') {
        console.error(pc.red(`\n❌ Unknown --target '${opts.target}'. Supported: claude-code`));
        process.exit(1);
      }
      const agent = await AgentReady.fromFile(path.resolve(process.cwd(), schema));
      const ops: HookOp[] = agent.allOperations.map((o: any) => ({
        name: o.name,
        risk_level: o.risk_level,
        reason:
          o.human_confirmation?.message_template ??
          o.description ??
          `Operation ${o.name} requires confirmation`,
      }));
      const outDir = path.resolve(process.cwd(), opts.out);
      fs.mkdirSync(outDir, { recursive: true });
      const scriptFile = path.join(outDir, 'ars-pretooluse.mjs');
      fs.writeFileSync(scriptFile, buildHookScript(opts.server, ops), 'utf8');
      const snippetFile = path.join(outDir, 'settings.snippet.json');
      const snippet = buildSettingsSnippet(opts.server, scriptFile.replace(/\\/g, '/'));
      fs.writeFileSync(snippetFile, JSON.stringify(snippet, null, 2) + '\n', 'utf8');
      console.log(pc.green(`\n✅ Wrote ${scriptFile}`));
      console.log(pc.green(`✅ Wrote ${snippetFile}`));
      console.log(`Merge settings.snippet.json into .claude/settings.json (format: ${HOOK_DOC_URL})`);
    } catch (err: any) {
      console.error(pc.red(`\n❌ Error: ${err.message}`));
      process.exit(1);
    }
  });

await program.parseAsync();
