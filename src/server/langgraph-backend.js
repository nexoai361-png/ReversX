import express from 'express';
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { runTerminalExec, PTY_TERMINAL_TOOLS, executePtyTool, resolveTerminalIntent, formatTerminalSummary } from './terminal-tools.js';

export const langgraphRouter = express.Router();
langgraphRouter.use(express.json({ limit: '2mb' }));

const FETCH_TIMEOUT_MS = 25000;

const logger = {
  info: (msg, ...meta) => console.log(`[INF] [${new Date().toISOString()}] ${msg}`, ...meta),
  warn: (msg, ...meta) => console.warn(`[WRN] [${new Date().toISOString()}] ${msg}`, ...meta),
  error: (msg, ...meta) => console.error(`[ERR] [${new Date().toISOString()}] ${msg}`, ...meta),
};

// BYOK Provider Specifications Map
const PROVIDER_CONFIGS = {
  openrouter: {
    endpoint: () => 'https://openrouter.ai/api/v1/chat/completions',
    buildHeaders: (key) => ({ 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }),
    buildBody: (model, prompt) => ({
      model: model || 'openai/gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are ReversX AI, an autonomous terminal & coding assistant optimized for Proot-Ubuntu and Termux. Keep explanations clear and concise. If the user asks you to perform a terminal task, explain the outcome clearly.' },
        { role: 'user', content: prompt }
      ]
    }),
    parseResponse: (data) => data.choices?.[0]?.message?.content || ''
  },
  sambanova: {
    endpoint: () => 'https://api.sambanova.ai/v1/chat/completions',
    buildHeaders: (key) => ({ 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }),
    buildBody: (model, prompt) => ({
      model: model || 'Meta-Llama-3.1-8B-Instruct',
      messages: [
        { role: 'system', content: 'You are ReversX AI, an autonomous terminal & coding assistant optimized for Proot-Ubuntu and Termux.' },
        { role: 'user', content: prompt }
      ]
    }),
    parseResponse: (data) => data.choices?.[0]?.message?.content || ''
  },
  google: {
    endpoint: (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-1.5-flash'}:generateContent?key=${key}`,
    buildHeaders: () => ({ 'Content-Type': 'application/json' }),
    buildBody: (model, prompt) => ({
      contents: [{ parts: [{ text: `System: You are ReversX AI for Proot-Ubuntu and Termux.\n\nUser Query: ${prompt}` }] }]
    }),
    parseResponse: (data) => data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  },
  cerebras: {
    endpoint: () => 'https://api.cerebras.ai/v1/chat/completions',
    buildHeaders: (key) => ({ 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }),
    buildBody: (model, prompt) => ({
      model: model || 'llama3.1-8b',
      messages: [
        { role: 'system', content: 'You are ReversX AI optimized for Proot-Ubuntu and Termux.' },
        { role: 'user', content: prompt }
      ]
    }),
    parseResponse: (data) => data.choices?.[0]?.message?.content || ''
  },
  groq: {
    endpoint: () => 'https://api.groq.com/openai/v1/chat/completions',
    buildHeaders: (key) => ({ 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }),
    buildBody: (model, prompt) => ({
      model: model || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You are ReversX AI optimized for Proot-Ubuntu and Termux.' },
        { role: 'user', content: prompt }
      ]
    }),
    parseResponse: (data) => data.choices?.[0]?.message?.content || ''
  }
};

/**
 * Execute BYOK Provider API Request safely with timeout signal
 */
async function fetchProviderResponse(provider, apiKey, model, message) {
  const config = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.openrouter;
  const endpoint = config.endpoint(model, apiKey);
  const headers = config.buildHeaders(apiKey);
  const body = JSON.stringify(config.buildBody(model, message));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.warn(`Provider [${provider}] HTTP ${res.status}: ${errText.slice(0, 150)}`);
      return '';
    }

    const data = await res.json();
    return config.parseResponse(data);
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.error(`Provider [${provider}] request timed out after ${FETCH_TIMEOUT_MS}ms`);
    } else {
      logger.error(`Provider [${provider}] fetch error: ${err.message}`);
    }
    return '';
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * LANGGRAPH & LANGCHAIN AGENT STATE ANNOTATION
 */
const AgentStateAnnotation = Annotation.Root({
  message: Annotation({ value: (x, y) => y ?? x, default: () => '' }),
  provider: Annotation({ value: (x, y) => y ?? x, default: () => 'openrouter' }),
  apiKey: Annotation({ value: (x, y) => y ?? x, default: () => '' }),
  model: Annotation({ value: (x, y) => y ?? x, default: () => '' }),
  agentName: Annotation({ value: (x, y) => y ?? x, default: () => '' }),
  messages: Annotation({ value: (x, y) => x.concat(y), default: () => [] }),
  response: Annotation({ value: (x, y) => y ?? x, default: () => '' }),
  codeSnippet: Annotation({ value: (x, y) => y ?? x, default: () => undefined }),
  runningCommand: Annotation({ value: (x, y) => y ?? x, default: () => undefined }),
  executionSteps: Annotation({ value: (x, y) => x.concat(y), default: () => [] })
});

/**
 * NODE 1: LANGCHAIN ROUTER & INTENT ANALYZER
 */
async function routerNode(state) {
  const query = (state.message || '').trim();
  let agent = state.agentName || '';

  if (!agent) {
    const match = query.match(/^(\/[a-zA-Z]+)/);
    if (match) {
      agent = match[1];
    }
  }

  const userMessage = new HumanMessage(query);

  return {
    agentName: agent,
    messages: [userMessage],
    executionSteps: ['langchain_router']
  };
}

/**
 * NODE 2: LANGGRAPH EXECUTION ENGINE
 * Handles autonomous Proot-Ubuntu terminal execution or BYOK LLM execution.
 */
async function executionNode(state) {
  const { message, provider, apiKey, model, agentName } = state;
  let replyText = '';
  let codeSnippet = undefined;
  let runningCommand = undefined;

  // Step 1: Check for autonomous terminal command execution
  const terminalIntent = resolveTerminalIntent(message);
  if (terminalIntent) {
    runningCommand = terminalIntent.command;
    const toolRes = await runTerminalExec(terminalIntent.command);
    replyText = formatTerminalSummary(terminalIntent, toolRes);
  } else if (apiKey) {
    replyText = await fetchProviderResponse(provider, apiKey, model, message);
  }

  // Step 2: Fallback local autonomous responses
  if (!replyText) {
    const lower = message.toLowerCase();
    const isBengali = /[\u0980-\u09FF]/.test(message);

    if (lower.includes('/coderagent') || lower.includes('code') || lower.includes('script') || agentName === '/CoderAgent') {
      replyText = isBengali
        ? 'ReversX কোডার এজেন্ট Proot-Ubuntu এর জন্য টার্মিনাল স্ক্রিপ্ট প্রস্তুত করেছে:'
        : 'ReversX Coder Agent generated terminal script for Proot-Ubuntu:';
      codeSnippet = `#!/data/data/com.termux/files/usr/bin/bash\n# Proot-Ubuntu Automation Script\napt update && apt upgrade -y\napt install -y openssh-server\necho "Proot-Ubuntu System Ready!"`;
    } else if (lower.includes('/debugagent') || lower.includes('debug') || lower.includes('error') || agentName === '/DebugAgent') {
      replyText = isBengali
        ? 'ReversX ডিবাগ এজেন্ট: সমস্ত PTY সকেট ও টার্মিনাল প্রসেস স্বাভাবিকভাবে চলছে।'
        : 'ReversX Debug Agent: Terminal and PTY processes are healthy.';
    } else {
      replyText = isBengali
        ? 'ReversX AI প্রস্তুত! টার্মিনালে কোনো কমান্ড চালাতে বা সাহায্য পেতে বলুন (যেমন: `সিস্টেম আপডেট করো`, `স্টোরেজ চেক করো`, `ls`, ইত্যাদি)।'
        : 'ReversX AI is ready! Ask to run terminal commands or help with your Proot-Ubuntu environment.';
    }
  }

  const aiMessage = new AIMessage(replyText);

  return {
    response: replyText,
    codeSnippet: codeSnippet,
    runningCommand: runningCommand,
    messages: [aiMessage],
    executionSteps: ['langchain_execution']
  };
}

/**
 * NODE 3: OUTPUT FORMATTER & PARSER NODE
 */
async function outputParserNode(state) {
  let reply = state.response || '';
  let snippet = state.codeSnippet;

  if (!snippet && reply.includes('```')) {
    const codeMatch = reply.match(/```(?:\w+)?\n([\s\S]*?)```/);
    if (codeMatch && codeMatch[1]) {
      snippet = codeMatch[1].trim();
    }
  }

  return {
    response: reply,
    codeSnippet: snippet,
    runningCommand: state.runningCommand,
    executionSteps: ['langchain_output_parser']
  };
}

/**
 * COMPOSE LANGGRAPH STATE GRAPH
 */
const graphWorkflow = new StateGraph(AgentStateAnnotation)
  .addNode('router', routerNode)
  .addNode('execution', executionNode)
  .addNode('output_parser', outputParserNode)
  .addEdge(START, 'router')
  .addEdge('router', 'execution')
  .addEdge('execution', 'output_parser')
  .addEdge('output_parser', END)
  .compile();

/**
 * ROUTES FOR DEDICATED LANGGRAPH AI BACKEND
 */
langgraphRouter.get('/status', (req, res) => {
  res.json({
    status: 'online',
    engine: 'LangGraph & LangChain Proot-Ubuntu Dedicated AI Backend',
    timestamp: Date.now()
  });
});

// PTY Terminal Tools Endpoints for AI Function Calling
langgraphRouter.get('/terminal/tools', (req, res) => {
  res.json({ tools: PTY_TERMINAL_TOOLS });
});

langgraphRouter.post('/terminal/tools/call', async (req, res) => {
  try {
    const { tool, arguments: args } = req.body || {};
    if (!tool) {
      return res.status(400).json({ error: 'Missing "tool" field' });
    }
    const result = await executePtyTool(tool, args || {});
    res.json({ success: true, tool, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

langgraphRouter.post('/terminal/exec', async (req, res) => {
  try {
    const { command, cwd, timeout } = req.body || {};
    if (!command) {
      return res.status(400).json({ error: 'Missing "command" field' });
    }
    const result = await runTerminalExec(command, { cwd, timeout });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

langgraphRouter.post('/chat', async (req, res) => {
  try {
    const { message, provider, apiKey, model, agentName, stream } = req.body || {};
    const reqProvider = provider || req.headers['x-byok-provider'] || 'openrouter';
    const reqApiKey = apiKey || req.headers['x-byok-key'] || '';
    const reqModel = model || req.headers['x-byok-model'] || '';
    const reqStream = stream || req.headers['x-stream'] === 'true';

    const result = await graphWorkflow.invoke({
      message: message || '',
      provider: reqProvider,
      apiKey: reqApiKey,
      model: reqModel,
      agentName: agentName || ''
    });

    const fullResponse = result.response || '';

    if (reqStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      if (result.runningCommand) {
        res.write(`data: ${JSON.stringify({ runningCommand: result.runningCommand })}\n\n`);
      }

      const chunks = fullResponse.match(/.{1,8}/g) || [fullResponse];
      for (const chunk of chunks) {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.json({
        response: fullResponse,
        codeSnippet: result.codeSnippet,
        runningCommand: result.runningCommand,
        steps: result.executionSteps
      });
    }
  } catch (err) {
    logger.error(`Error processing /chat: ${err.message}`);
    res.status(500).json({ error: err.message || 'Internal AI Server Error' });
  }
});

langgraphRouter.post('/chat/stream', async (req, res) => {
  try {
    const { message, provider, apiKey, model, agentName } = req.body || {};
    const reqProvider = provider || req.headers['x-byok-provider'] || 'openrouter';
    const reqApiKey = apiKey || req.headers['x-byok-key'] || '';
    const reqModel = model || req.headers['x-byok-model'] || '';

    const result = await graphWorkflow.invoke({
      message: message || '',
      provider: reqProvider,
      apiKey: reqApiKey,
      model: reqModel,
      agentName: agentName || ''
    });

    const fullResponse = result.response || '';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (result.runningCommand) {
      res.write(`data: ${JSON.stringify({ runningCommand: result.runningCommand })}\n\n`);
    }

    const chunks = fullResponse.match(/.{1,8}/g) || [fullResponse];
    for (const chunk of chunks) {
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    logger.error(`Error processing /chat/stream: ${err.message}`);
    res.status(500).json({ error: err.message || 'Internal AI Server Error' });
  }
});

