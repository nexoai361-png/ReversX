import express from 'express';
import http from 'http';
import { StateGraph, END, START } from '@langchain/langgraph';

// Configuration
const PORT = process.env.AI_PORT || process.env.PORT || 3001;
const FETCH_TIMEOUT_MS = 25000;

// Structured Logger
const logger = {
  info: (msg, ...meta) => console.log(`[INF] [${new Date().toISOString()}] ${msg}`, ...meta),
  warn: (msg, ...meta) => console.warn(`[WRN] [${new Date().toISOString()}] ${msg}`, ...meta),
  error: (msg, ...meta) => console.error(`[ERR] [${new Date().toISOString()}] ${msg}`, ...meta),
};

// BYOK Provider Registry Strategy Map
const PROVIDER_CONFIGS = {
  openrouter: {
    endpoint: () => 'https://openrouter.ai/api/v1/chat/completions',
    buildHeaders: (key) => ({ 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }),
    buildBody: (model, prompt) => ({
      model: model || 'openai/gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }]
    }),
    parseResponse: (data) => data.choices?.[0]?.message?.content || JSON.stringify(data)
  },
  sambanova: {
    endpoint: () => 'https://api.sambanova.ai/v1/chat/completions',
    buildHeaders: (key) => ({ 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }),
    buildBody: (model, prompt) => ({
      model: model || 'Meta-Llama-3.1-8B-Instruct',
      messages: [{ role: 'user', content: prompt }]
    }),
    parseResponse: (data) => data.choices?.[0]?.message?.content || JSON.stringify(data)
  },
  google: {
    endpoint: (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-1.5-flash'}:generateContent?key=${key}`,
    buildHeaders: () => ({ 'Content-Type': 'application/json' }),
    buildBody: (model, prompt) => ({
      contents: [{ parts: [{ text: prompt }] }]
    }),
    parseResponse: (data) => data.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(data)
  },
  cerebras: {
    endpoint: () => 'https://api.cerebras.ai/v1/chat/completions',
    buildHeaders: (key) => ({ 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }),
    buildBody: (model, prompt) => ({
      model: model || 'llama3.1-8b',
      messages: [{ role: 'user', content: prompt }]
    }),
    parseResponse: (data) => data.choices?.[0]?.message?.content || JSON.stringify(data)
  },
  groq: {
    endpoint: () => 'https://api.groq.com/openai/v1/chat/completions',
    buildHeaders: (key) => ({ 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }),
    buildBody: (model, prompt) => ({
      model: model || 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }]
    }),
    parseResponse: (data) => data.choices?.[0]?.message?.content || JSON.stringify(data)
  }
};

/**
 * Execute external AI provider HTTP request with timeout control
 */
async function executeProviderRequest(provider, apiKey, model, prompt) {
  const config = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.openrouter;
  const endpoint = config.endpoint(model, apiKey);
  const headers = config.buildHeaders(apiKey);
  const body = JSON.stringify(config.buildBody(model, prompt));

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
      return `[BYOK Provider Error ${res.status}]: ${errText || res.statusText}`;
    }

    const data = await res.json();
    return config.parseResponse(data);
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.error(`Provider [${provider}] request timed out after ${FETCH_TIMEOUT_MS}ms`);
      return `[BYOK Provider Error]: Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`;
    }
    logger.error(`Provider [${provider}] execution error: ${err.message}`);
    return `[BYOK Execution Error]: ${err.message}`;
  } finally {
    clearTimeout(timeoutId);
  }
}

// LangGraph Agent State Definition
const graphState = {
  messages: {
    value: (x, y) => x.concat(y),
    default: () => []
  },
  provider: {
    value: (x, y) => y ?? x,
    default: () => 'google'
  },
  apiKey: {
    value: (x, y) => y ?? x,
    default: () => ''
  },
  model: {
    value: (x, y) => y ?? x,
    default: () => ''
  },
  response: {
    value: (x, y) => y ?? x,
    default: () => ''
  }
};

// Node 1: Router & Agent Classifier
async function agentRouterNode(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  const text = (lastMessage?.content || '').toLowerCase();
  
  let agentType = 'general';
  if (text.includes('/coderagent') || text.includes('code') || text.includes('script') || text.includes('bash')) {
    agentType = 'coder';
  } else if (text.includes('/debugagent') || text.includes('debug') || text.includes('error')) {
    agentType = 'debug';
  } else if (text.includes('/explainagent') || text.includes('explain')) {
    agentType = 'explain';
  } else if (text.includes('/searchagent') || text.includes('search')) {
    agentType = 'search';
  }

  return { agentType };
}

// Node 2: Provider Execution Engine
async function providerExecutorNode(state) {
  const { provider, apiKey, model, messages } = state;
  const userText = messages[messages.length - 1]?.content || '';

  if (apiKey) {
    const response = await executeProviderRequest(provider, apiKey, model, userText);
    return { response };
  }

  // Fallback Local Agent Response Generator
  let reply = "ReversX LangGraph AI Backend received your query.";
  const lowerText = userText.toLowerCase();
  if (lowerText.includes('code') || lowerText.includes('script')) {
    reply = "Here is a code snippet generated by ReversX Local LangGraph Engine:\n\n```bash\n#!/bin/bash\necho 'ReversX AI Local Backend Active'\n```";
  } else if (lowerText.includes('debug')) {
    reply = "ReversX Debugger Agent: System diagnostics clear. No memory leaks detected.";
  }

  return { response: reply };
}

// Construct LangGraph Workflow
const workflow = new StateGraph({ channels: graphState })
  .addNode('router', agentRouterNode)
  .addNode('executor', providerExecutorNode)
  .addEdge(START, 'router')
  .addEdge('router', 'executor')
  .addEdge('executor', END);

const langGraphApp = workflow.compile();

// Express Application Setup
const app = express();
app.use(express.json({ limit: '2mb' }));

// Enable CORS for mobile webview / Cordova / localhost
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-byok-provider, x-byok-key, x-byok-model');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Health & Status Endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    engine: 'LangGraph Orchestrator',
    timestamp: new Date().toISOString()
  });
});

app.get('/status', (req, res) => {
  res.json({
    online: true,
    provider: 'ReversX Local Backend'
  });
});

// API Chat Endpoint (Supports JSON & SSE Streaming)
app.post('/api/chat', async (req, res) => {
  try {
    const { message, provider, apiKey, model, stream } = req.body || {};
    const reqProvider = provider || req.headers['x-byok-provider'] || 'openrouter';
    const reqApiKey = apiKey || req.headers['x-byok-key'] || '';
    const reqModel = model || req.headers['x-byok-model'] || '';
    const reqStream = stream || req.headers['x-stream'] === 'true';

    const inputs = {
      messages: [{ role: 'user', content: message || '' }],
      provider: reqProvider,
      apiKey: reqApiKey,
      model: reqModel
    };

    const result = await langGraphApp.invoke(inputs);
    const fullResponse = result.response || '';

    if (reqStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Stream text in small chunks for smooth streaming UI
      const chunks = fullResponse.match(/.{1,8}/g) || [fullResponse];
      for (const chunk of chunks) {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.json({ response: fullResponse });
    }
  } catch (err) {
    logger.error(`Error processing /api/chat: ${err.message}`);
    res.status(500).json({ error: err.message || 'Internal AI Backend Server Error' });
  }
});

app.post('/api/chat/stream', async (req, res) => {
  try {
    const { message, provider, apiKey, model } = req.body || {};
    const reqProvider = provider || req.headers['x-byok-provider'] || 'openrouter';
    const reqApiKey = apiKey || req.headers['x-byok-key'] || '';
    const reqModel = model || req.headers['x-byok-model'] || '';

    const inputs = {
      messages: [{ role: 'user', content: message || '' }],
      provider: reqProvider,
      apiKey: reqApiKey,
      model: reqModel
    };

    const result = await langGraphApp.invoke(inputs);
    const fullResponse = result.response || '';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const chunks = fullResponse.match(/.{1,8}/g) || [fullResponse];
    for (const chunk of chunks) {
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    logger.error(`Error processing /api/chat/stream: ${err.message}`);
    res.status(500).json({ error: err.message || 'Internal AI Backend Server Error' });
  }
});

// Create and start HTTP Server
const server = http.createServer(app);

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`ReversX LangGraph AI Backend running on port ${PORT}`);
});

// Graceful Shutdown Handlers
const handleShutdown = (signal) => {
  logger.info(`Received ${signal}. Gracefully shutting down AI Backend server...`);
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
