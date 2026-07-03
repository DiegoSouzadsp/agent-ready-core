#!/usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';
import { AgentReady } from '@agent-ready/core';
import fs from 'node:fs';
import path from 'node:path';

const program = new Command();

program
  .name('ars')
  .description('Agent-Ready Schema CLI — Governance layer for AI agents')
  .version('0.1.0');

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

program.parse();
