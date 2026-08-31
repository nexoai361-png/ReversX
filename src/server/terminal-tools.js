import { exec } from 'child_process';
import path from 'path';
import os from 'os';

let DEFAULT_TIMEOUT_MS = 30000; // 30 seconds default
let CURRENT_CWD = process.cwd();

/**
 * Helper to run shell commands with timeout, cwd, and structured status output
 */
export function runTerminalExec(command, options = {}) {
  const cwd = options.cwd || CURRENT_CWD;
  const timeout = options.timeout ? options.timeout * 1000 : DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    const startTime = Date.now();
    exec(
      command,
      {
        cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        shell: '/bin/bash'
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startTime;
        let exitCode = 0;
        let signal = null;

        if (error) {
          exitCode = error.code !== undefined ? error.code : 1;
          signal = error.signal || null;
          if (error.killed) {
            signal = signal || 'SIGTERM';
          }
        }

        const combinedOutput = (stdout || '') + (stderr ? `\n[STDERR]\n${stderr}` : '');

        // Update working directory if cd command was run
        if (command.trim().startsWith('cd ')) {
          const targetDir = command.trim().substring(3).trim();
          const resolved = path.resolve(cwd, targetDir);
          CURRENT_CWD = resolved;
        }

        resolve({
          terminal_output: combinedOutput.trim() || '(No output)',
          terminal_cwd: cwd,
          terminal_exit_code: exitCode,
          terminal_signal: signal,
          terminal_timeout: Math.round(timeout / 1000),
          duration_ms: durationMs,
          success: exitCode === 0
        });
      }
    );
  });
}

/**
 * PTY Terminal Tools Definition Object for AI Functions / Tool Calling
 */
export const PTY_TERMINAL_TOOLS = [
  {
    name: 'terminal_exec',
    description: 'Shell command run in PTY Terminal environment',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        cwd: { type: 'string', description: 'Optional working directory for command' },
        timeout: { type: 'number', description: 'Maximum execution timeout in seconds' }
      },
      required: ['command']
    }
  },
  {
    name: 'terminal_output',
    description: 'Get command stdout and stderr output result',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to get output from' }
      },
      required: ['command']
    }
  },
  {
    name: 'terminal_cwd',
    description: 'Get current working directory of the terminal',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'terminal_exit_code',
    description: 'Check command execution success or failure status code',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to check exit status' }
      },
      required: ['command']
    }
  },
  {
    name: 'terminal_signal',
    description: 'Check how process ended / process termination signal (e.g., SIGTERM, SIGKILL)',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute and monitor signal' }
      },
      required: ['command']
    }
  },
  {
    name: 'terminal_timeout',
    description: 'Configure or check maximum execution timeout duration in seconds',
    parameters: {
      type: 'object',
      properties: {
        seconds: { type: 'number', description: 'Timeout in seconds' }
      }
    }
  }
];

/**
 * Execute a specific tool by name
 */
export async function executePtyTool(toolName, args = {}) {
  switch (toolName) {
    case 'terminal_exec': {
      return await runTerminalExec(args.command, { cwd: args.cwd, timeout: args.timeout });
    }
    case 'terminal_output': {
      const res = await runTerminalExec(args.command);
      return { terminal_output: res.terminal_output };
    }
    case 'terminal_cwd': {
      return { terminal_cwd: CURRENT_CWD };
    }
    case 'terminal_exit_code': {
      const res = await runTerminalExec(args.command);
      return { terminal_exit_code: res.terminal_exit_code, success: res.success };
    }
    case 'terminal_signal': {
      const res = await runTerminalExec(args.command);
      return { terminal_signal: res.terminal_signal };
    }
    case 'terminal_timeout': {
      if (args.seconds && args.seconds > 0) {
        DEFAULT_TIMEOUT_MS = args.seconds * 1000;
      }
      return { terminal_timeout: Math.round(DEFAULT_TIMEOUT_MS / 1000) };
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
