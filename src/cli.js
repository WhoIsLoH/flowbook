#!/usr/bin/env node
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { parse } from 'yaml';
import { runPlaybook, validatePlaybook } from './runner.js';

const { version } = createRequire(import.meta.url)('../package.json');
const program = new Command();

program
  .name('flowbook')
  .description('Versioned business-flow playbooks for web apps')
  .version(version);

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
  .argument('<files...>', 'One or more Flowbook YAML playbooks')
  .description('Validate playbook structure without executing steps')
  .action(async (filePaths) => {
    let failed = false;
    for (const filePath of filePaths) {
      try {
        const abs = resolve(filePath);
        const raw = await readFile(abs, 'utf8');
        const doc = parse(raw);
        const issues = validatePlaybook(doc);
        if (issues.length === 0) {
          console.log(`✓ Valid playbook: ${doc.name || abs}`);
          console.log(`  steps: ${(doc.steps || []).length}`);
        } else {
          failed = true;
          console.error(`✗ Invalid playbook ${filePath} (${issues.length} issue(s)):`);
          for (const issue of issues) console.error(`  - ${issue}`);
        }
      } catch (err) {
        failed = true;
        console.error(`\n✗ Fatal (${filePath}): ${err.message}`);
      }
    }
    process.exitCode = failed ? 1 : 0;
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
