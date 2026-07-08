import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseK6Summary, parsePlaywrightJson } from './parse';
import { type RunRequest, type RunnerResult, type TestRunner, summarize } from './types';

const execFileP = promisify(execFile);

/** execFile that never throws — a non-zero exit is a normal test outcome, not an exception. */
async function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
    return { stdout, stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number | string; killed?: boolean; message?: string };
    const code = typeof err.code === 'number' ? err.code : err.killed ? 124 : 1;
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? err.message ?? '', code };
  }
}

/**
 * Spawns the real industry tool (Playwright / k6) against the given script in an
 * isolated temp dir, then normalizes its reporter output. Every failure mode —
 * tool not installed, timeout, unparseable output — degrades to a clean
 * `status: 'error'` result with a bounded message, never a thrown exception.
 *
 * This executes user-provided code, so it is OPT-IN (config `runner: 'real'`) and
 * bounded by a wall-clock timeout. It never runs in tests/CI by default.
 */
export class RealTestRunner implements TestRunner {
  readonly mode = 'real' as const;

  constructor(private readonly timeoutMs: number) {}

  async run(req: RunRequest): Promise<RunnerResult> {
    const dir = await mkdtemp(join(tmpdir(), 'arbiter-run-'));
    try {
      return req.kind === 'playwright' ? await this.runPlaywright(req.script, dir) : await this.runK6(req.script, dir);
    } catch (e) {
      return this.errorResult(e instanceof Error ? e.message : String(e));
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private errorResult(message: string, exitCode: number | null = null): RunnerResult {
    return { mode: 'real', status: 'error', summary: { total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0 }, cases: [], exitCode, error: message.slice(0, 500) };
  }

  private async runPlaywright(script: string, dir: string): Promise<RunnerResult> {
    await writeFile(join(dir, 'arbiter.spec.js'), script, 'utf8');
    // The spec lives in an isolated temp dir, but @playwright/test must resolve —
    // so we run from the app's cwd (its node_modules has it) and point the config's
    // absolute testDir at the temp dir. JSON reporter writes to a file (not stdout)
    // so runner banners can never corrupt the parse.
    const reportPath = join(dir, 'report.json');
    const configPath = join(dir, 'arbiter.pw.config.cjs');
    await writeFile(
      configPath,
      `module.exports = { testDir: ${JSON.stringify(dir)}, reporter: [['json', { outputFile: ${JSON.stringify(reportPath)} }]], use: { headless: true }, fullyParallel: true };`,
      'utf8',
    );
    const { stderr, code } = await run('npx', ['playwright', 'test', '--config', configPath], process.cwd(), this.timeoutMs);
    let raw: string;
    try {
      raw = await readFile(reportPath, 'utf8');
    } catch {
      return this.errorResult(`Playwright produced no report — is @playwright/test installed with browsers (npx playwright install)? ${stderr}`, code);
    }
    let cases;
    try {
      cases = parsePlaywrightJson(raw);
    } catch {
      return this.errorResult(`Playwright report was not parseable. ${stderr}`, code);
    }
    const durationMs = cases.reduce((s, c) => s + c.durationMs, 0);
    const { summary, status } = summarize(cases, durationMs);
    return { mode: 'real', status, summary, cases, exitCode: code };
  }

  private async runK6(script: string, dir: string): Promise<RunnerResult> {
    await writeFile(join(dir, 'script.js'), script, 'utf8');
    const summaryPath = join(dir, 'summary.json');
    const { stderr, code } = await run('k6', ['run', '--quiet', `--summary-export=${summaryPath}`, 'script.js'], dir, this.timeoutMs);
    let raw: string;
    try {
      raw = await readFile(summaryPath, 'utf8');
    } catch {
      return this.errorResult(`k6 wrote no summary — is k6 installed and the script valid? ${stderr}`, code);
    }
    let cases;
    try {
      cases = parseK6Summary(raw);
    } catch {
      return this.errorResult(`k6 summary was not parseable. ${stderr}`, code);
    }
    // k6 exit code is non-zero when a threshold is breached; reflect that even if
    // every check passed (a threshold breach is still a failing load test).
    const { summary, status: caseStatus } = summarize(cases, 0);
    const status = code !== 0 && caseStatus === 'passed' ? 'failed' : caseStatus;
    return { mode: 'real', status, summary, cases, exitCode: code };
  }
}
