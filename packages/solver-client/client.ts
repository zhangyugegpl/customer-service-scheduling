import { spawn } from 'node:child_process';
import path from 'node:path';
import type { GenerateScheduleRequest, SolverMetrics } from '../contracts/types';

export interface RawSolverResult {
  solverVersion: string;
  solverStatus: string;
  status: 'PUBLISHABLE' | 'EXCEPTION' | 'INFEASIBLE' | 'TIMEOUT' | 'ERROR';
  assignments: Array<{ employeeId: string; date: string; state: string }>;
  metrics: SolverMetrics;
  error?: string;
  trace?: string;
}

export interface SolverClientOptions {
  packaged: boolean;
  resourcesPath: string;
  projectRoot: string;
  solverPathOverride?: string;
  pythonExecutable?: string;
}

export class SolverClient {
  constructor(private readonly options: SolverClientOptions) {}

  async health(): Promise<{ ok: boolean; solverVersion: string }> {
    return this.runProcess(undefined, ['--health']) as Promise<{ ok: boolean; solverVersion: string }>;
  }

  async solve(request: GenerateScheduleRequest): Promise<RawSolverResult> {
    return this.runProcess(request, []) as Promise<RawSolverResult>;
  }

  private async runProcess(input: unknown, argumentsList: string[]): Promise<unknown> {
    const command = this.resolveCommand(argumentsList);
    return new Promise((resolve, reject) => {
      const child = spawn(command.executable, command.arguments, {
        cwd: this.options.projectRoot,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: command.environment,
      });
      let stdout = '';
      let stderr = '';
      const maximumOutput = 20 * 1024 * 1024;
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        if (stdout.length > maximumOutput) child.kill();
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
        if (stderr.length > maximumOutput) child.kill();
      });
      child.on('error', (error) => reject(new Error(`无法启动排班求解器：${error.message}`)));
      child.on('close', (code) => {
        try {
          const parsed = JSON.parse(stdout) as { status?: string; error?: string };
          if (code !== 0 || parsed.status === 'ERROR') {
            reject(new Error(`排班求解器失败：${parsed.error ?? (stderr || `退出码 ${code}`)}`));
            return;
          }
          resolve(parsed);
        } catch (error) {
          reject(new Error(`排班求解器返回了无效结果：${error instanceof Error ? error.message : String(error)}；${stderr}`));
        }
      });
      if (input === undefined) child.stdin.end();
      else child.stdin.end(JSON.stringify(input));
    });
  }

  private resolveCommand(argumentsList: string[]): { executable: string; arguments: string[]; environment: NodeJS.ProcessEnv } {
    const override = this.options.solverPathOverride;
    if (override) {
      if (override.toLowerCase().endsWith('.py')) {
        return {
          executable: this.options.pythonExecutable ?? 'python',
          arguments: [override, ...argumentsList],
          environment: this.developmentEnvironment(),
        };
      }
      return { executable: override, arguments: argumentsList, environment: this.processEnvironment() };
    }
    if (this.options.packaged) {
      return {
        executable: path.join(this.options.resourcesPath, 'solver', 'scheduler-solver.exe'),
        arguments: argumentsList,
        environment: this.processEnvironment(),
      };
    }
    return {
      executable: this.options.pythonExecutable ?? 'python',
      arguments: [path.join(this.options.projectRoot, 'apps', 'solver', 'main.py'), ...argumentsList],
      environment: this.developmentEnvironment(),
    };
  }

  private developmentEnvironment(): NodeJS.ProcessEnv {
    const packages = path.join(this.options.projectRoot, '.python-packages');
    const existing = process.env.PYTHONPATH;
    return { ...this.processEnvironment(), PYTHONPATH: existing ? `${packages}${path.delimiter}${existing}` : packages };
  }

  private processEnvironment(): NodeJS.ProcessEnv {
    return { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  }
}
