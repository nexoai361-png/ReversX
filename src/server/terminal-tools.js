import { exec } from 'child_process';
import path from 'path';
import os from 'os';

let DEFAULT_TIMEOUT_MS = 30000; // 30 seconds default
let CURRENT_CWD = process.cwd();

/**
 * Detect Shell for proot-ubuntu, Termux, and Linux environments
 */
function getSystemShell() {
  if (process.env.SHELL) return process.env.SHELL;
  if (os.platform() === 'win32') return undefined;
  return '/bin/bash';
}

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
        shell: getSystemShell()
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
 * Autonomous intent detection for Proot-Ubuntu & Termux terminal commands
 */
export function resolveTerminalIntent(userText) {
  if (!userText) return null;
  const text = userText.trim();
  const lower = text.toLowerCase();

  // Direct tool prefix or direct bash commands (e.g. run: ls, exec: df -h, cmd: pkg update)
  const toolExecMatch = text.match(/^(?:run|exec|terminal_exec|cmd|execute)[:\s]+(.+)$/i);
  if (toolExecMatch) {
    return { command: toolExecMatch[1].trim(), isBengali: false, action: 'raw_command' };
  }

  const isBengali = /[\u0980-\u09FF]/.test(text);

  // Bengali command wrapper phrases (e.g., "টার্মিনালে কমান্ড রান করো ls -la", "কমান্ড চালাও pkg update", "রান করো df -h")
  const bnExecMatch = text.match(/(?:টার্মিনালে\s+)?(?:কমান্ড\s+)?(?:রান\s+করো|চালাও|চালিয়ে\s+দাও|এক্সিকিউট\s+করো|run\s+করো)[:\s]+(.+)$/i) ||
                      text.match(/(?:রান|run|exec)\s+(?:করো\s+)?([a-zA-Z0-9_\-\.\s\/]+)/i);
  if (bnExecMatch && bnExecMatch[1]) {
    const raw = bnExecMatch[1].trim();
    if (raw && !['system', 'প্যাকেজ'].includes(raw.toLowerCase())) {
      return { command: raw, isBengali, action: 'raw_command' };
    }
  }

  // System Update / Upgrade (Bengali & English)
  if (
    lower.includes('আপডেট') ||
    lower.includes('update system') ||
    lower.includes('system update') ||
    lower.includes('update packages') ||
    lower === 'pkg update' ||
    lower === 'apt update'
  ) {
    return { command: 'apt update -y || pkg update -y', isBengali, action: 'system_update' };
  }

  if (
    lower.includes('আপগ্রেড') ||
    lower.includes('upgrade system') ||
    lower.includes('system upgrade') ||
    lower === 'pkg upgrade' ||
    lower === 'apt upgrade'
  ) {
    return { command: 'apt upgrade -y || pkg upgrade -y', isBengali, action: 'system_upgrade' };
  }

  // Package Installation
  const installMatchBn = text.match(/(?:প্যাকেজ\s+)?([a-zA-Z0-9_\-\.]+)\s+(?:ইন্সটল|ইনস্টল|ইন্সটল করো|ইনস্টল করো)/i) ||
                         text.match(/(?:ইন্সটল|ইনস্টল|install)\s+(?:করো\s+)?([a-zA-Z0-9_\-\.]+)/i);
  if (installMatchBn && installMatchBn[1] && !['system', 'packages', 'app'].includes(installMatchBn[1].toLowerCase())) {
    const pkgName = installMatchBn[1].trim();
    return { command: `apt install -y ${pkgName} || pkg install -y ${pkgName}`, isBengali, action: 'package_install', pkgName };
  }

  // Disk / Storage
  if (lower.includes('স্টোরেজ') || lower.includes('ডিস্ক') || lower.includes('জায়গা') || lower.includes('storage') || lower.includes('disk space') || lower.includes('disk usage')) {
    return { command: 'df -h', isBengali, action: 'disk_check' };
  }

  // RAM / Memory
  if (lower.includes('র‍্যাম') || lower.includes('মেমোরি') || lower.includes('ram') || lower.includes('memory') || lower.includes('free ram')) {
    return { command: 'free -h || free -m || cat /proc/meminfo', isBengali, action: 'memory_check' };
  }

  // List Files
  if (lower.includes('ফাইল তালিকা') || lower.includes('ফাইল দেখো') || lower.includes('ডিরেক্টরি ফাইল') || lower.includes('ফাইল দেখাও') || lower.includes('list files') || lower.includes('show files') || lower === 'ls' || lower === 'dir') {
    return { command: 'ls -la', isBengali, action: 'list_files' };
  }

  // Current Working Directory
  if (lower.includes('কোথায় আছি') || lower.includes('বর্তমান ডিরেক্টরি') || lower.includes('current directory') || lower.includes('where am i') || lower === 'pwd') {
    return { command: 'pwd', isBengali, action: 'pwd' };
  }

  // Running Processes
  if (lower.includes('প্রসেস') || lower.includes('চলমান প্রসেস') || lower.includes('processes') || lower.includes('running processes') || lower === 'top' || lower === 'ps') {
    return { command: 'ps aux | head -n 15', isBengali, action: 'processes' };
  }

  // Node version / Python version / Git status
  if (lower.includes('node ভার্সন') || lower.includes('node version')) {
    return { command: 'node -v', isBengali, action: 'version_check', toolName: 'Node.js' };
  }
  if (lower.includes('python ভার্সন') || lower.includes('python version')) {
    return { command: 'python3 --version || python --version', isBengali, action: 'version_check', toolName: 'Python' };
  }
  if (lower.includes('git স্ট্যাটাস') || lower.includes('git status')) {
    return { command: 'git status', isBengali, action: 'git_status' };
  }

  // Raw Linux Command Detection (e.g. user typed apt, git, npm, curl, mkdir, etc.)
  const rawCmdPrefixes = ['apt ', 'pkg ', 'git ', 'npm ', 'curl ', 'wget ', 'mkdir ', 'cat ', 'grep ', 'rm ', 'python ', 'python3 ', 'node ', 'sh ', 'bash ', 'chmod ', 'chown ', 'tar ', 'zip ', 'unzip ', 'uname', 'whoami', 'uptime'];
  if (rawCmdPrefixes.some(prefix => lower.startsWith(prefix) || lower === prefix.trim())) {
    return { command: text, isBengali, action: 'raw_command' };
  }

  return null;
}

/**
 * Format autonomous intelligent response after command execution (hiding raw spam, summarizing outcome)
 */
export function formatTerminalSummary(intent, execResult) {
  const { command, isBengali, action, pkgName } = intent;
  const { success, terminal_output, terminal_exit_code, duration_ms } = execResult;

  const durationSec = (duration_ms / 1000).toFixed(1);

  if (isBengali) {
    if (success) {
      switch (action) {
        case 'system_update':
          return `✅ **সিস্টেম আপডেট সফলভাবে সম্পন্ন হয়েছে**\n\n- **কমান্ড**: \`${command}\`\n- **স্ট্যাটাস**: সমস্ত রিপোজিটরি প্যাকেজ তালিকা রিফ্রেশ ও সিঙ্ক্রোনাইজ করা হয়েছে (${durationSec}s)।\n- **ফলাফল**: Proot-Ubuntu / Linux সিস্টেম প্যাকেজ এখন পুরোপুরি আপ-টু-ডেট।`;
        case 'system_upgrade':
          return `✅ **সিস্টেম আপগ্রেড সফলভাবে সম্পন্ন হয়েছে**\n\n- **কমান্ড**: \`${command}\`\n- **স্ট্যাটাস**: সব প্যাকেজ সফলভাবে সর্বশেষ সংস্করণে আপগ্রেড করা হয়েছে (${durationSec}s)।`;
        case 'package_install':
          return `✅ **${pkgName || 'প্যাকেজ'} সফলভাবে ইনস্টল করা হয়েছে**\n\n- **কমান্ড**: \`${command}\`\n- **স্ট্যাটাস**: প্যাকেজটি সফলভাবে টার্মিনালে ইনস্টল ও কনফিগার করা হয়েছে (${durationSec}s)।`;
        case 'disk_check':
          return `📊 **স্টোরেজ ও ডিস্ক ব্যবহারের বিবরণী**:\n\n\`\`\`\n${terminal_output}\n\`\`\`\n- **স্ট্যাটাস**: স্টোরেজ ডাটা সফলভাবে রিড করা হয়েছে।`;
        case 'memory_check':
          return `🧠 **র‍্যাম (RAM) ও মেমোরি বিবরণী**:\n\n\`\`\`\n${terminal_output}\n\`\`\`\n- **স্ট্যাটাস**: সিস্টেম মেমোরি তথ্য উদ্ধার করা হয়েছে।`;
        case 'list_files':
          return `📁 **বর্তমান ডিরেক্টরির ফাইল ও ফোল্ডার তালিকা**:\n\n\`\`\`\n${terminal_output}\n\`\`\``;
        case 'pwd':
          return `📍 **বর্তমান ওয়ার্কিং ডিরেক্টরি**:\n\n\`\`\`\n${terminal_output}\n\`\`\``;
        default:
          return `✅ **কমান্ড সফলভাবে এক্সিকিউট হয়েছে**\n\n- **কমান্ড**: \`${command}\`\n- **স্ট্যাটাস**: সম্পন্ন (এক্সিট কোড: ${terminal_exit_code}, সময়: ${durationSec}s)`;
      }
    } else {
      return `⚠️ **কমান্ড এক্সিকিউশনে সমস্যা হয়েছে**\n\n- **কমান্ড**: \`${command}\`\n- **এক্সিট কোড**: ${terminal_exit_code}\n- **ত্রুটির বিবরণ**: ${terminal_output.slice(0, 300) || 'Unknown error'}\n\nঅনুগ্রহ করে টার্মিনাল পারমিশন অথবা প্যাকেজের নাম যাচাই করুন।`;
    }
  } else {
    if (success) {
      switch (action) {
        case 'system_update':
          return `✅ **System Update Completed Successfully**\n\n- **Command**: \`${command}\`\n- **Status**: Repository package lists refreshed and synchronized in ${durationSec}s.\n- **Result**: Proot-Ubuntu packages are now up to date.`;
        case 'system_upgrade':
          return `✅ **System Upgrade Completed Successfully**\n\n- **Command**: \`${command}\`\n- **Status**: Upgraded all installed packages to latest versions in ${durationSec}s.`;
        case 'package_install':
          return `✅ **Package Installed Successfully**\n\n- **Command**: \`${command}\`\n- **Status**: ${pkgName || 'Package'} installed and ready to use (${durationSec}s).`;
        case 'disk_check':
          return `📊 **Disk Storage Summary**:\n\n\`\`\`\n${terminal_output}\n\`\`\``;
        case 'memory_check':
          return `🧠 **Memory (RAM) Usage Summary**:\n\n\`\`\`\n${terminal_output}\n\`\`\``;
        case 'list_files':
          return `📁 **Directory Contents**:\n\n\`\`\`\n${terminal_output}\n\`\`\``;
        case 'pwd':
          return `📍 **Current Working Directory**:\n\n\`\`\`\n${terminal_output}\n\`\`\``;
        default:
          return `✅ **Command Executed Successfully**\n\n- **Command**: \`${command}\`\n- **Status**: Exit code ${terminal_exit_code} (${durationSec}s)`;
      }
    } else {
      return `⚠️ **Command Execution Error**\n\n- **Command**: \`${command}\`\n- **Exit Code**: ${terminal_exit_code}\n- **Error**: ${terminal_output.slice(0, 300) || 'Unknown error'}`;
    }
  }
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
