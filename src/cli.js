#!/usr/bin/env node
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { runPlaybook, validatePlaybook } from './runner.js';

const program = new Command();

program
  .name('flowbook')
  .description('Versioned business-flow playbooks for web apps')
  .version('0.1.0');

program
  .command('run')
  .argument('<playbook>', 'Path to a Flowbook YAML playbook')
  .option('--base-url <url>', 'Override playbook baseUrl')
  .description('Execute a playbook and print a step-by-step report')
  .action(async (playbookPath, opts) => {
    try {
      const abs = resolve(playbookPath);
      const raw = await readFile(abs, 'utf8');
      const doc = parse(raw);
      const result = await runPlaybook(doc, {
        baseUrlOverride: opts.baseUrl,
        sourcePath: abs,
      });
      printReport(result);
      process.exitCode = result.ok ? 0 : 1;
    } catch (err) {
      console.error(`\n✗ Fatal: ${err.message}`);
      process.exitCode = 1;
    }
  });

program
  .command('validate')
  .argument('<file>', 'Path to a Flowbook YAML playbook')
  .description('Validate playbook structure without executing HTTP steps')
  .action(async (filePath) => {
    try {
      const abs = resolve(filePath);
      const raw = await readFile(abs, 'utf8');
      const doc = parse(raw);
      const issues = validatePlaybook(doc);
      if (issues.length === 0) {
        console.log(`✓ Valid playbook: ${doc.name || abs}`);
        console.log(`  steps: ${(doc.steps || []).length}`);
        process.exitCode = 0;
      } else {
        console.error(`✗ Invalid playbook (${issues.length} issue(s)):`);
        for (const issue of issues) console.error(`  - ${issue}`);
        process.exitCode = 1;
      }
    } catch (err) {
      console.error(`\n✗ Fatal: ${err.message}`);
      process.exitCode = 1;
    }
  });

function printReport(result) {
  console.log('');
  console.log(`Flowbook: ${result.name}`);
  console.log(`baseUrl:  ${result.baseUrl}`);
  console.log('─'.repeat(56));
  for (const step of result.steps) {
    const icon = step.ok ? '✓' : '✗';
    const dur = step.durationMs != null ? ` (${step.durationMs}ms)` : '';
    console.log(`${icon} [${step.id}] ${step.type}${dur}`);
    if (step.detail) console.log(`    ${step.detail}`);
    if (step.error) console.log(`    error: ${step.error}`);
    if (step.captures && Object.keys(step.captures).length) {
      for (const [k, v] of Object.entries(step.captures)) {
        console.log(`    capture ${k}=${JSON.stringify(v)}`);
      }
    }
  }
  console.log('─'.repeat(56));
  if (result.ok) {
    console.log(`PASS  ${result.passed}/${result.total} steps`);
  } else {
    console.log(`FAIL  ${result.passed}/${result.total} steps`);
  }
  console.log('');
}

program.parseAsync(process.argv);
