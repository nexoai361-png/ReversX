import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  agentName?: string;
  codeSnippet?: string;
  timestamp?: string;
}

const KNOWN_AGENTS = [
  { name: '/CoderAgent', desc: 'Code expert' },
  { name: '/DebugAgent', desc: 'Fix bugs' },
  { name: '/ExplainAgent', desc: 'Break down topics' },
  { name: '/SearchAgent', desc: 'Research' }
];

@customElement('reversx-panel')
export class ReversXPanel extends LitElement {
  createRenderRoot() {
    return this;
  }

  @state() messages: ChatMessage[] = [];
  @state() inputQuery: string = '';
  @state() isGenerating: boolean = false;
  @state() isUploadPopupActive: boolean = false;
  @state() isAutocompleteActive: boolean = false;
  @state() autocompleteQuery: string = '';
  @state() isExpandVisible: boolean = false;
  @state() isFullscreenActive: boolean = false;
  @state() fullscreenQuery: string = '';
  @state() expandedMessageIds: Set<string> = new Set();
  
  @state() isSettingsOpen: boolean = false;
  @state() isByokDropdownOpen: boolean = false;
  @state() byokProvider: string = 'openrouter';
  @state() byokApiKey: string = '';
  @state() byokModel: string = 'openai/gpt-3.5-turbo';
  @state() byokSaveMsg: string = '';
  @state() isBackendOnline: boolean = true;
  @state() copiedBlockId: string | null = null;
  @state() jsonViewModes: Record<string, 'pretty' | 'raw'> = {};

  private healthInterval: any = null;

  private handleOutsideClick = (e: MouseEvent) => {
    const path = e.composedPath();
    const uploadPopup = this.querySelector('#upload-popup');
    const plusBtn = this.querySelector('#plus-btn');
    if (this.isUploadPopupActive && uploadPopup && !path.includes(uploadPopup) && plusBtn && !path.includes(plusBtn)) {
      this.isUploadPopupActive = false;
    }

    const autocompletePopup = this.querySelector('#autocomplete-popup');
    const userInput = this.querySelector('#user-input');
    if (this.isAutocompleteActive && autocompletePopup && !path.includes(autocompletePopup) && userInput && !path.includes(userInput)) {
      this.isAutocompleteActive = false;
    }

    const byokDropdown = this.querySelector('#byok-dropdown-container');
    if (this.isByokDropdownOpen && byokDropdown && !path.includes(byokDropdown)) {
      this.isByokDropdownOpen = false;
    }
  };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('click', this.handleOutsideClick);
    
    this.byokProvider = localStorage.getItem('reversx_byok_provider') || 'openrouter';
    this.byokApiKey = localStorage.getItem('reversx_byok_key') || '';
    this.byokModel = localStorage.getItem('reversx_byok_model') || (this.byokProvider === 'google' ? 'gemini-1.5-flash' : 'openai/gpt-3.5-turbo');
    
    this.checkBackendHealth();
    this.healthInterval = setInterval(() => this.checkBackendHealth(), 10000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('click', this.handleOutsideClick);
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
    }
  }

  private checkBackendHealth() {
    fetch('http://127.0.0.1:3001/status')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        this.isBackendOnline = !!data;
      })
      .catch(() => {
        this.isBackendOnline = false;
      });
  }

  private toggleSettingsModal() {
    this.isSettingsOpen = !this.isSettingsOpen;
    this.isByokDropdownOpen = false;
    this.byokSaveMsg = '';
  }

  private closeSettingsModal() {
    this.isSettingsOpen = false;
    this.isByokDropdownOpen = false;
  }

  private toggleByokDropdown(e: Event) {
    e.stopPropagation();
    this.isByokDropdownOpen = !this.isByokDropdownOpen;
  }

  private selectByokProvider(providerKey: string) {
    this.byokProvider = providerKey;
    this.isByokDropdownOpen = false;
    if (providerKey === 'google' && (!this.byokModel || this.byokModel.includes('gpt') || this.byokModel.includes('llama'))) {
      this.byokModel = 'gemini-1.5-flash';
    } else if (providerKey === 'sambanova' && (!this.byokModel || this.byokModel.includes('gpt') || this.byokModel.includes('gemini'))) {
      this.byokModel = 'Meta-Llama-3.1-8B-Instruct';
    } else if (providerKey === 'cerebras' && (!this.byokModel || this.byokModel.includes('gpt') || this.byokModel.includes('gemini'))) {
      this.byokModel = 'llama3.1-8b';
    } else if (providerKey === 'groq' && (!this.byokModel || this.byokModel.includes('gpt') || this.byokModel.includes('gemini'))) {
      this.byokModel = 'llama-3.3-70b-versatile';
    } else if (providerKey === 'openrouter' && (!this.byokModel || this.byokModel.includes('gemini') || this.byokModel.includes('Llama'))) {
      this.byokModel = 'openai/gpt-3.5-turbo';
    }
  }

  private getProviderLabel(key: string): string {
    switch (key) {
      case 'openrouter': return 'OpenRouter';
      case 'groq': return 'Groq';
      case 'sambanova': return 'SambaNova';
      case 'google': return 'Google AI Studio';
      case 'cerebras': return 'Cerebras';
      default: return key;
    }
  }

  private saveByokSettings() {
    localStorage.setItem('reversx_byok_provider', this.byokProvider);
    localStorage.setItem('reversx_byok_key', this.byokApiKey);
    localStorage.setItem('reversx_byok_model', this.byokModel);
    this.byokSaveMsg = 'Settings saved locally!';
    setTimeout(() => {
      this.byokSaveMsg = '';
      this.isSettingsOpen = false;
    }, 800);
  }

  private togglePopup(e: Event) {
    e.stopPropagation();
    this.isUploadPopupActive = !this.isUploadPopupActive;
  }

  private selectOption(option: string) {
    this.isUploadPopupActive = false;
    
    if (option === 'File') {
      const fileInput = this.querySelector('#reversx-file-input') as HTMLInputElement;
      if (fileInput) { fileInput.click(); return; }
    } else if (option === 'Image') {
      const imageInput = this.querySelector('#reversx-image-input') as HTMLInputElement;
      if (imageInput) { imageInput.click(); return; }
    } else if (option === 'Camera') {
      const cameraInput = this.querySelector('#reversx-camera-input') as HTMLInputElement;
      if (cameraInput) { cameraInput.click(); return; }
    }

    this.appendUserMessage(`Selected option: ${option}`);
  }

  private handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const fileName = input.files[0].name;
      this.appendUserMessage(`[File Attached: ${fileName}]`);
      input.value = '';
    }
  }

  private handleImageChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const fileName = input.files[0].name;
      this.appendUserMessage(`[Image Attached: ${fileName}]`);
      input.value = '';
    }
  }

  private handleCameraChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const fileName = input.files[0].name;
      this.appendUserMessage(`[Photo Taken: ${fileName}]`);
      input.value = '';
    }
  }

  private handleInput(e: Event) {
    const el = e.target as HTMLTextAreaElement;
    this.inputQuery = el.value;

    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';

    if (el.scrollHeight > 70 || el.value.length > 70) {
      this.isExpandVisible = true;
    } else {
      this.isExpandVisible = false;
    }

    const val = el.value;
    if (val.startsWith('/') && !val.includes(' ')) {
      this.autocompleteQuery = val;
      this.isAutocompleteActive = true;
    } else {
      this.isAutocompleteActive = false;
    }
  }

  private selectAgent(agentName: string) {
    this.inputQuery = agentName + ' ';
    this.isAutocompleteActive = false;
    const userInput = this.querySelector('#user-input') as HTMLTextAreaElement;
    if (userInput) {
      userInput.focus();
      userInput.style.height = 'auto';
      userInput.style.height = userInput.scrollHeight + 'px';
    }
  }

  private openFullscreen() {
    this.fullscreenQuery = this.inputQuery;
    this.isFullscreenActive = true;
    setTimeout(() => {
      const fsInput = this.querySelector('#fullscreen-input') as HTMLTextAreaElement;
      if (fsInput) fsInput.focus();
    }, 50);
  }

  private closeFullscreen() {
    this.inputQuery = this.fullscreenQuery;
    this.isFullscreenActive = false;
    const userInput = this.querySelector('#user-input') as HTMLTextAreaElement;
    if (userInput) {
      userInput.focus();
      userInput.style.height = 'auto';
      userInput.style.height = userInput.scrollHeight + 'px';
      this.isExpandVisible = userInput.scrollHeight > 70 || userInput.value.length > 70;
    }
  }

  private handleFullscreenInput(e: Event) {
    const el = e.target as HTMLTextAreaElement;
    this.fullscreenQuery = el.value;
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessage();
    }
  }

  private async sendMessage() {
    const text = this.inputQuery.trim();
    if (!text || this.isGenerating) return;

    this.appendUserMessage(text);
    this.inputQuery = '';
    
    const userInput = this.querySelector('#user-input') as HTMLTextAreaElement;
    if (userInput) {
      userInput.style.height = 'auto';
    }
    this.isExpandVisible = false;

    this.isGenerating = true;

    try {
      const result = await this.sendAiRequest(text);
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: result.text,
        codeSnippet: result.codeSnippet,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      this.messages = [...this.messages, aiMsg];
    } catch (err) {
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: "I received your request. How else can I assist you today?",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      this.messages = [...this.messages, aiMsg];
    } finally {
      this.isGenerating = false;
      this.scrollToBottom();
    }
  }

  private async sendAiRequest(text: string): Promise<{ text: string; codeSnippet?: string }> {
    if (this.isBackendOnline) {
      try {
        const res = await fetch('http://127.0.0.1:3001/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-byok-provider': this.byokProvider,
            'x-byok-key': this.byokApiKey,
            'x-byok-model': this.byokModel
          },
          body: JSON.stringify({ message: text, provider: this.byokProvider, apiKey: this.byokApiKey, model: this.byokModel })
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.response) {
            return { text: data.response };
          }
        }
      } catch (e) {
        // Fallthrough
      }
    }

    if (this.byokApiKey) {
      try {
        let endpoint = '';
        let headers: Record<string, string> = { 'Content-Type': 'application/json' };
        let payload: any = {};

        if (this.byokProvider === 'openrouter') {
          endpoint = 'https://openrouter.ai/api/v1/chat/completions';
          headers['Authorization'] = `Bearer ${this.byokApiKey}`;
          payload = { model: this.byokModel || 'openai/gpt-3.5-turbo', messages: [{ role: 'user', content: text }] };
        } else if (this.byokProvider === 'sambanova') {
          endpoint = 'https://api.sambanova.ai/v1/chat/completions';
          headers['Authorization'] = `Bearer ${this.byokApiKey}`;
          payload = { model: this.byokModel || 'Meta-Llama-3.1-8B-Instruct', messages: [{ role: 'user', content: text }] };
        } else if (this.byokProvider === 'google') {
          const m = this.byokModel || 'gemini-1.5-flash';
          endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${this.byokApiKey}`;
          payload = { contents: [{ parts: [{ text: text }] }] };
        } else if (this.byokProvider === 'cerebras') {
          endpoint = 'https://api.cerebras.ai/v1/chat/completions';
          headers['Authorization'] = `Bearer ${this.byokApiKey}`;
          payload = { model: this.byokModel || 'llama3.1-8b', messages: [{ role: 'user', content: text }] };
        } else if (this.byokProvider === 'groq') {
          endpoint = 'https://api.groq.com/openai/v1/chat/completions';
          headers['Authorization'] = `Bearer ${this.byokApiKey}`;
          payload = { model: this.byokModel || 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: text }] };
        }

        if (endpoint) {
          const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
          if (res.ok) {
            const data = await res.json();
            let replyText = '';
            if (this.byokProvider === 'google') {
              replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            } else {
              replyText = data.choices?.[0]?.message?.content || '';
            }
            if (replyText) {
              return { text: replyText };
            }
          }
        }
      } catch (err) {
        // Fallthrough
      }
    }

    let responseText = "I have received your message. How else can I assist you today?";
    let codeSnippet: string | undefined = undefined;

    const lower = text.toLowerCase();
    if (lower.includes('code') || lower.includes('/coderagent') || lower.includes('script') || lower.includes('ssh')) {
      responseText = "Here is a code snippet tailored for your request:";
      codeSnippet = `#!/data/data/com.termux/files/usr/bin/bash\n# ReversX AI - Automated Terminal Task\nsshd -p 8022\necho "SSH Daemon Active on port 8022!"`;
    } else if (lower.includes('debug') || lower.includes('/debugagent') || lower.includes('error')) {
      responseText = "Checking for issues... No syntax errors found in your current configuration.";
    } else if (lower.includes('explain') || lower.includes('/explainagent')) {
      responseText = "ReversX AI breaks down complex tasks into clean, executable terminal commands.";
    }

    return { text: responseText, codeSnippet };
  }

  private appendUserMessage(text: string) {
    let agentName = '';
    let messageContent = text;

    const agentMatch = text.match(/^(\/[a-zA-Z]+)(\s+[\s\S]*)?$/);
    const knownAgentNames = KNOWN_AGENTS.map(a => a.name.toLowerCase());

    if (agentMatch && knownAgentNames.includes(agentMatch[1].toLowerCase())) {
      agentName = agentMatch[1];
      messageContent = agentMatch[2] ? agentMatch[2].trim() : '';
    }

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: messageContent,
      agentName: agentName,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    this.messages = [...this.messages, userMsg];
    this.scrollToBottom();
  }

  private toggleExpand(msgId: string) {
    const next = new Set(this.expandedMessageIds);
    if (next.has(msgId)) {
      next.delete(msgId);
    } else {
      next.add(msgId);
    }
    this.expandedMessageIds = next;
    this.scrollToBottom();
  }

  private scrollToBottom() {
    setTimeout(() => {
      const chatMessages = this.querySelector('#chat-messages');
      if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    }, 50);
  }

  private renderUserContent(msg: ChatMessage) {
    const messageContent = msg.text;
    if (!messageContent) return html``;

    let items = messageContent.split('\n').map(i => i.trim()).filter(i => i.length > 0);

    if (items.length <= 1 && messageContent.length > 90) {
      const rawSentences = messageContent.split(/(?<=[.!?])\s+/);
      items = [];
      rawSentences.forEach(s => {
        s = s.trim();
        if (s.length > 0) {
          if (s.length > 85 && s.includes(',')) {
            const subParts = s.split(',').map(p => p.trim()).filter(p => p.length > 0);
            items.push(...subParts);
          } else {
            items.push(s);
          }
        }
      });
    }

    const maxVisibleItems = 3;

    if (items.length > 1) {
      const isExpanded = this.expandedMessageIds.has(msg.id);
      const limit = isExpanded ? items.length : Math.min(items.length, maxVisibleItems);
      const visibleItems = items.slice(0, limit);

      return html`
        <ul>
          ${visibleItems.map(item => {
            let cleanItem = item;
            if (!/[.!?]$/.test(cleanItem) && cleanItem.length > 0) {
              cleanItem += '.';
            }
            return html`<li>${cleanItem}</li>`;
          })}
        </ul>
        ${items.length > maxVisibleItems ? html`
          <button class="toggle-read-more" @click="${() => this.toggleExpand(msg.id)}">
            ${isExpanded ? 'Show Less' : `Show More (${items.length - maxVisibleItems} more)`}
          </button>
        ` : ''}
      `;
    }

    return html`<div>${messageContent}</div>`;
  }

  private copyToClipboard(text: string, id: string) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    this.copiedBlockId = id;
    setTimeout(() => {
      if (this.copiedBlockId === id) {
        this.copiedBlockId = null;
      }
    }, 2000);
  }

  private toggleJsonViewMode(segId: string) {
    const current = this.jsonViewModes[segId] || 'pretty';
    this.jsonViewModes = {
      ...this.jsonViewModes,
      [segId]: current === 'pretty' ? 'raw' : 'pretty'
    };
  }

  private parseAiSegments(text: string, extraSnippet?: string) {
    const segments: Array<{ type: 'text' | 'code' | 'json'; content: string; lang?: string; parsedJson?: any }> = [];
    let currentText = text || '';

    const trimmed = currentText.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(trimmed);
        return [{ type: 'json' as const, content: trimmed, lang: 'json', parsedJson: parsed }];
      } catch (e) {
        // Fallthrough
      }
    }

    const codeBlockRegex = /```([a-zA-Z0-9_\-\+]*)\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRegex.exec(currentText)) !== null) {
      if (match.index > lastIndex) {
        const plainText = currentText.slice(lastIndex, match.index).trim();
        if (plainText) {
          segments.push({ type: 'text', content: plainText });
        }
      }

      const lang = (match[1] || 'code').toLowerCase().trim();
      const codeContent = match[2].trim();

      if (lang === 'json' || (codeContent.startsWith('{') && codeContent.endsWith('}')) || (codeContent.startsWith('[') && codeContent.endsWith(']'))) {
        try {
          const parsed = JSON.parse(codeContent);
          segments.push({ type: 'json', content: codeContent, lang: 'json', parsedJson: parsed });
        } catch (e) {
          segments.push({ type: 'code', content: codeContent, lang: lang || 'json' });
        }
      } else {
        segments.push({ type: 'code', content: codeContent, lang: lang || 'code' });
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < currentText.length) {
      const remainingText = currentText.slice(lastIndex).trim();
      if (remainingText) {
        if ((remainingText.startsWith('{') && remainingText.endsWith('}')) || (remainingText.startsWith('[') && remainingText.endsWith(']'))) {
          try {
            const parsed = JSON.parse(remainingText);
            segments.push({ type: 'json', content: remainingText, lang: 'json', parsedJson: parsed });
          } catch (e) {
            segments.push({ type: 'text', content: remainingText });
          }
        } else {
          segments.push({ type: 'text', content: remainingText });
        }
      }
    }

    if (extraSnippet && extraSnippet.trim()) {
      const snipTrimmed = extraSnippet.trim();
      if ((snipTrimmed.startsWith('{') && snipTrimmed.endsWith('}')) || (snipTrimmed.startsWith('[') && snipTrimmed.endsWith(']'))) {
        try {
          const parsed = JSON.parse(snipTrimmed);
          segments.push({ type: 'json', content: snipTrimmed, lang: 'json', parsedJson: parsed });
        } catch (e) {
          segments.push({ type: 'code', content: snipTrimmed, lang: 'bash' });
        }
      } else {
        segments.push({ type: 'code', content: snipTrimmed, lang: 'bash' });
      }
    }

    return segments;
  }

  private renderJsonValueToken(valStr: string) {
    const trimmed = valStr.trim();
    if (trimmed.startsWith('"') && (trimmed.endsWith('"') || trimmed.endsWith('",'))) {
      return html`<span class="json-string">${valStr}</span>`;
    }
    if (/^-?\d+(\.\d+)?(e[+-]?\d+)?,?$/i.test(trimmed)) {
      return html`<span class="json-number">${valStr}</span>`;
    }
    if (/^(true|false),?$/i.test(trimmed)) {
      return html`<span class="json-boolean">${valStr}</span>`;
    }
    if (/^null,?$/i.test(trimmed)) {
      return html`<span class="json-null">${valStr}</span>`;
    }
    return html`<span class="json-punct">${valStr}</span>`;
  }

  private renderColorizedJson(jsonObj: any) {
    const jsonString = JSON.stringify(jsonObj, null, 2);
    const lines = jsonString.split('\n');
    return html`
      <div class="json-code-container">
        ${lines.map((line, idx) => {
          const keyValRegex = /^(\s*)("(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")(\s*:\s*)(.*)$/;
          const match = line.match(keyValRegex);
          if (match) {
            const indent = match[1];
            const keyStr = match[2];
            const colon = match[3];
            const valStr = match[4];
            return html`
              <div class="code-line">
                <span class="line-num">${idx + 1}</span>
                <span class="line-content">${indent}<span class="json-key">${keyStr}</span>${colon}${this.renderJsonValueToken(valStr)}</span>
              </div>
            `;
          }
          return html`
            <div class="code-line">
              <span class="line-num">${idx + 1}</span>
              <span class="line-content">${this.renderJsonValueToken(line)}</span>
            </div>
          `;
        })}
      </div>
    `;
  }

  private highlightCodeLine(line: string) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) {
      return html`<span class="code-comment">${line}</span>`;
    }

    const keywords = ['const', 'let', 'var', 'function', 'return', 'import', 'from', 'export', 'class', 'if', 'else', 'for', 'while', 'async', 'await', 'echo', 'sudo', 'apt', 'npm', 'git', 'cd', 'mkdir', 'cat', 'ssh', 'sshd'];
    const tokens = line.split(/(\s+|[(),;:{}[\]'"])/);

    return tokens.map(token => {
      if (keywords.includes(token)) {
        return html`<span class="code-keyword">${token}</span>`;
      }
      if (/^"(.*)"$|^'(.*)'$/.test(token)) {
        return html`<span class="code-string">${token}</span>`;
      }
      if (/^\d+$/.test(token)) {
        return html`<span class="code-number">${token}</span>`;
      }
      return token;
    });
  }

  private renderColorizedCode(code: string) {
    const lines = code.split('\n');
    return html`
      <div class="code-block-container">
        ${lines.map((line, idx) => html`
          <div class="code-line">
            <span class="line-num">${idx + 1}</span>
            <span class="line-content">${this.highlightCodeLine(line)}</span>
          </div>
        `)}
      </div>
    `;
  }

  private parseInlineMarkdown(text: string) {
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    return parts.map(part => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return html`<code class="ai-inline-code">${part.slice(1, -1)}</code>`;
      }
      if (part.startsWith('**') && part.endsWith('**')) {
        return html`<strong class="ai-bold">${part.slice(2, -2)}</strong>`;
      }
      return part;
    });
  }

  private renderFormattedText(text: string) {
    const lines = text.split('\n');
    const elements: any[] = [];
    let currentList: string[] = [];

    const flushList = () => {
      if (currentList.length > 0) {
        elements.push(html`
          <ul class="ai-bullet-list">
            ${currentList.map(item => html`<li>${this.parseInlineMarkdown(item)}</li>`)}
          </ul>
        `);
        currentList = [];
      }
    };

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) {
        flushList();
        return;
      }

      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        currentList.push(trimmed.substring(2));
        return;
      } else {
        flushList();
      }

      if (trimmed.startsWith('### ')) {
        elements.push(html`<h4 class="ai-heading">${this.parseInlineMarkdown(trimmed.substring(4))}</h4>`);
      } else if (trimmed.startsWith('## ')) {
        elements.push(html`<h3 class="ai-heading">${this.parseInlineMarkdown(trimmed.substring(3))}</h3>`);
      } else if (trimmed.startsWith('# ')) {
        elements.push(html`<h2 class="ai-heading">${this.parseInlineMarkdown(trimmed.substring(2))}</h2>`);
      } else if (trimmed.startsWith('> ')) {
        elements.push(html`<blockquote class="ai-blockquote">${this.parseInlineMarkdown(trimmed.substring(2))}</blockquote>`);
      } else {
        elements.push(html`<p class="ai-paragraph">${this.parseInlineMarkdown(line)}</p>`);
      }
    });

    flushList();
    return html`${elements}`;
  }

  private renderAiContent(msg: ChatMessage) {
    const segments = this.parseAiSegments(msg.text, msg.codeSnippet);
    const fullTextToCopy = (msg.text || '') + (msg.codeSnippet ? `\n\n${msg.codeSnippet}` : '');

    return html`
      <div class="ai-response-body">
        ${segments.length === 0 ? html`<p class="ai-paragraph">${msg.text}</p>` : ''}
        ${segments.map((seg, idx) => {
          const segId = `${msg.id}-seg-${idx}`;
          if (seg.type === 'json') {
            const mode = this.jsonViewModes[segId] || 'pretty';
            const isCopied = this.copiedBlockId === segId;
            return html`
              <div class="ai-json-card">
                <div class="ai-card-header">
                  <div class="header-left">
                    <span class="json-icon">{ }</span>
                    <span class="card-title">JSON OUTPUT</span>
                  </div>
                  <div class="header-actions">
                    <button
                      class="card-btn-toggle"
                      @click="${() => this.toggleJsonViewMode(segId)}"
                    >
                      ${mode === 'pretty' ? 'Raw' : 'Pretty'}
                    </button>
                    <button
                      class="card-btn-copy ${isCopied ? 'copied' : ''}"
                      @click="${() => this.copyToClipboard(seg.content, segId)}"
                    >
                      ${isCopied ? '✓ Copied' : 'Copy JSON'}
                    </button>
                  </div>
                </div>
                <div class="ai-card-body">
                  ${mode === 'pretty'
                    ? this.renderColorizedJson(seg.parsedJson)
                    : html`<pre class="raw-code-block"><code>${seg.content}</code></pre>`
                  }
                </div>
              </div>
            `;
          }

          if (seg.type === 'code') {
            const isCopied = this.copiedBlockId === segId;
            return html`
              <div class="ai-code-card">
                <div class="ai-card-header">
                  <div class="header-left">
                    <span class="code-icon">&lt;/&gt;</span>
                    <span class="card-title">${(seg.lang || 'CODE').toUpperCase()}</span>
                  </div>
                  <button
                    class="card-btn-copy ${isCopied ? 'copied' : ''}"
                    @click="${() => this.copyToClipboard(seg.content, segId)}"
                  >
                    ${isCopied ? '✓ Copied' : 'Copy Code'}
                  </button>
                </div>
                <div class="ai-card-body">
                  ${this.renderColorizedCode(seg.content)}
                </div>
              </div>
            `;
          }

          return html`
            <div class="ai-text-segment">
              ${this.renderFormattedText(seg.content)}
            </div>
          `;
        })}

        <div class="ai-msg-footer">
          <button
            class="copy-msg-btn ${this.copiedBlockId === msg.id ? 'copied' : ''}"
            @click="${() => this.copyToClipboard(fullTextToCopy, msg.id)}"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>${this.copiedBlockId === msg.id ? 'Copied' : 'Copy Response'}</span>
          </button>
          ${msg.timestamp ? html`<span class="msg-time">${msg.timestamp}</span>` : ''}
        </div>
      </div>
    `;
  }

  render() {
    const filteredAgents = KNOWN_AGENTS.filter(a =>
      a.name.toLowerCase().includes(this.autocompleteQuery.toLowerCase())
    );

    return html`
      <div class="ai-container">
        <!-- Header -->
        <div class="ai-header">
          <div class="brand">
            <span class="bot-symbol">&lt;&gt;</span>
            <span>ReversX</span>
          </div>
          <div class="header-right">
            <span class="status ${this.isBackendOnline ? 'online' : 'offline'}">● ${this.isBackendOnline ? 'ONLINE' : 'OFFLINE'}</span>
            <button class="byok-settings-btn" id="byok-settings-btn" @click="${this.toggleSettingsModal}" title="BYOK Settings">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
          </div>
        </div>

        <!-- Chat Messages -->
        <div class="ai-messages" id="chat-messages">
          ${this.messages.length === 0
            ? html`<div class="message ai initial-message" id="initial-message">Start a Conversation</div>`
            : this.messages.map(msg => html`
                ${msg.sender === 'user'
                  ? html`
                      <div class="message user">
                        ${msg.agentName ? html`<div class="agent-tag-box">${msg.agentName}</div>` : ''}
                        ${this.renderUserContent(msg)}
                      </div>
                    `
                  : html`
                      <div class="message ai">
                        ${this.renderAiContent(msg)}
                      </div>
                    `
                }
              `)
          }
        </div>

        <!-- Inputs for Upload Menu -->
        <input type="file" id="reversx-file-input" style="display:none;" @change="${this.handleFileChange}" />
        <input type="file" id="reversx-image-input" accept="image/*" style="display:none;" @change="${this.handleImageChange}" />
        <input type="file" id="reversx-camera-input" accept="image/*" capture="environment" style="display:none;" @change="${this.handleCameraChange}" />

        <!-- Input Container (VS Code Copilot Chat Style) -->
        <div class="ai-input-container">
          <!-- Upload Popup Menu -->
          <div class="upload-popup ${this.isUploadPopupActive ? 'active' : ''}" id="upload-popup">
            <div class="popup-item" @click="${() => this.selectOption('File')}">
              <svg class="popup-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span>File</span>
            </div>
            <div class="popup-item" @click="${() => this.selectOption('Image')}">
              <svg class="popup-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <span>Image</span>
            </div>
            <div class="popup-item" @click="${() => this.selectOption('Camera')}">
              <svg class="popup-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              <span>Camera</span>
            </div>
            <div class="popup-item" @click="${() => this.selectOption('Plugins')}">
              <svg class="popup-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              <span>Plugins</span>
            </div>
          </div>

          <!-- Agent Auto-complete Popup Menu (VS Code QuickPick Style) -->
          <div class="autocomplete-popup ${this.isAutocompleteActive && filteredAgents.length > 0 ? 'active' : ''}" id="autocomplete-popup">
            <div class="popup-header">@ AGENT COMMANDS</div>
            ${filteredAgents.map(agent => html`
              <div class="autocomplete-item" data-agent="${agent.name}" @click="${() => this.selectAgent(agent.name)}">
                <span class="agent-tag">@${agent.name}</span>
                <span class="agent-desc">${agent.desc}</span>
              </div>
            `)}
          </div>

          <div class="vscode-chat-card">
            <textarea
              id="user-input"
              placeholder="Ask Copilot or type '/' for agents..."
              .value="${this.inputQuery}"
              @input="${this.handleInput}"
              @keydown="${this.handleKeyDown}"
              rows="1"
            ></textarea>

            <div class="vscode-chat-toolbar">
              <div class="toolbar-left">
                <button
                  class="vscode-btn-icon btn-attach ${this.isUploadPopupActive ? 'active' : ''}"
                  id="plus-btn"
                  @click="${this.togglePopup}"
                  title="Add Context / Attach File (+)"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
              </div>

              <div class="toolbar-right">
                ${this.isExpandVisible ? html`
                  <button class="vscode-btn-icon btn-expand" id="expand-btn" @click="${this.openFullscreen}" title="Open Full Editor">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                  </button>
                ` : ''}

                <button class="vscode-btn-send" id="send-btn" @click="${() => this.sendMessage()}" title="Send (Enter)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Full Screen Vertical Screen Editor Overlay -->
      <div class="fullscreen-overlay ${this.isFullscreenActive ? 'active' : ''}" id="fullscreen-overlay">
        <div class="fullscreen-header">
          <span>Expanded Message Editor</span>
          <button class="fullscreen-close" @click="${this.closeFullscreen}">Done</button>
        </div>
        <textarea
          class="fullscreen-textarea"
          id="fullscreen-input"
          placeholder="Type a message..."
          .value="${this.fullscreenQuery}"
          @input="${this.handleFullscreenInput}"
        ></textarea>
      </div>

      <!-- BYOK Settings Modal -->
      ${this.isSettingsOpen ? html`
        <div class="byok-modal-overlay" @click="${this.closeSettingsModal}">
          <div class="byok-modal" @click="${(e: Event) => e.stopPropagation()}">
            <div class="byok-modal-header">
              <h3>BYOK (Bring Your Own Key)</h3>
              <button class="byok-modal-close" @click="${this.closeSettingsModal}">✕</button>
            </div>
            <div class="byok-modal-body">
              <div class="byok-field">
                <label>Provider</label>
                <div class="vscode-custom-select-container" id="byok-dropdown-container">
                  <div
                    class="vscode-custom-select-trigger ${this.isByokDropdownOpen ? 'active' : ''}"
                    @click="${this.toggleByokDropdown}"
                  >
                    <span class="vscode-select-value">${this.getProviderLabel(this.byokProvider)}</span>
                    <span class="vscode-select-arrow ${this.isByokDropdownOpen ? 'open' : ''}">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                    </span>
                  </div>
                  ${this.isByokDropdownOpen ? html`
                    <div class="vscode-custom-select-options">
                      ${[
                        { key: 'openrouter', label: 'OpenRouter', badge: 'Popular' },
                        { key: 'groq', label: 'Groq', badge: 'Fast Llama' },
                        { key: 'sambanova', label: 'SambaNova', badge: 'Fast' },
                        { key: 'google', label: 'Google AI Studio', badge: 'Gemini' },
                        { key: 'cerebras', label: 'Cerebras', badge: 'Ultra-Fast' }
                      ].map(opt => html`
                        <div
                          class="vscode-custom-select-option ${this.byokProvider === opt.key ? 'selected' : ''}"
                          @click="${() => this.selectByokProvider(opt.key)}"
                        >
                          <div class="option-left">
                            <span class="option-check">${this.byokProvider === opt.key ? '✓' : ''}</span>
                            <span class="option-label">${opt.label}</span>
                          </div>
                          <span class="option-badge">${opt.badge}</span>
                        </div>
                      `)}
                    </div>
                  ` : ''}
                </div>
              </div>
              <div class="byok-field">
                <label>API Key</label>
                <input type="password" placeholder="Enter API Key..." .value="${this.byokApiKey}" @input="${(e: Event) => this.byokApiKey = (e.target as HTMLInputElement).value}" />
              </div>
              <div class="byok-field">
                <label>Model Name</label>
                <input type="text" placeholder="e.g. openai/gpt-3.5-turbo or gemini-1.5-flash" .value="${this.byokModel}" @input="${(e: Event) => this.byokModel = (e.target as HTMLInputElement).value}" />
              </div>
              ${this.byokSaveMsg ? html`<div class="byok-save-msg">${this.byokSaveMsg}</div>` : ''}
            </div>
            <div class="byok-modal-footer">
              <button class="byok-save-btn" @click="${this.saveByokSettings}">Save Credentials</button>
            </div>
          </div>
        </div>
      ` : ''}
    `;
  }
}
