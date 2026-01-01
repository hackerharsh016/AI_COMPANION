import React, { useState, useRef, useEffect } from 'react';
import { Upload, MessageSquare, User, Key, RefreshCw, Send, Settings, Sparkles, AlertCircle, Trash2 } from 'lucide-react';

/**
 * AI Companion - WhatsApp Persona Cloner
 * * A single-file React application that parses WhatsApp chat logs,
 * uses Gemini to analyze a target user's personality, and creates
 * an interactive chat bot mimicking that person.
 */

// --- Constants & Types ---

type Message = {
  role: 'user' | 'model';
  content: string;
  timestamp?: number;
};

type ParsedMessage = {
  date: string;
  sender: string;
  content: string;
};

type AppState = 'setup' | 'upload' | 'selection' | 'analyzing' | 'chat';

// --- Helper: WhatsApp Parser ---

const parseWhatsAppChat = (text: string): ParsedMessage[] => {
  const lines = text.split('\n');
  const messages: ParsedMessage[] = [];
  
  // Common regex patterns for WhatsApp exports (iOS and Android vary)
  // 1. [DD/MM/YY, HH:MM:SS] Sender: Message
  // 2. MM/DD/YY, HH:MM - Sender: Message
  const pattern1 = /^\[?(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)\]?\s+(?:- )?([^:]+):\s+(.+)/;
  
  let currentMessage: ParsedMessage | null = null;

  lines.forEach((line) => {
    // Remove invisible characters
    const cleanLine = line.replace(/[\u200e\u200f]/g, "").trim();
    if (!cleanLine) return;

    const match = cleanLine.match(pattern1);

    if (match) {
      // If we were building a message, push it
      if (currentMessage) {
        messages.push(currentMessage);
      }
      
      // Start new message
      currentMessage = {
        date: `${match[1]} ${match[2]}`,
        sender: match[3].trim(),
        content: match[4].trim()
      };
    } else {
      // This is likely a continuation of the previous message (multi-line)
      if (currentMessage) {
        currentMessage.content += `\n${cleanLine}`;
      }
    }
  });

  if (currentMessage) {
    messages.push(currentMessage);
  }

  return messages;
};

// --- Main Component ---

export default function AICompanionApp() {
  // State
  const [apiKey, setApiKey] = useState('');
  const [appState, setAppState] = useState<AppState>('setup');
  const [parsedMessages, setParsedMessages] = useState<ParsedMessage[]>([]);
  const [participants, setParticipants] = useState<string[]>([]);
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [systemInstruction, setSystemInstruction] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState('');

  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory, appState]);

  // --- API Interaction ---

  const callGemini = async (prompt: string, systemPrompt?: string, history?: Message[]) => {
    if (!apiKey) throw new Error("API Key missing");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
      
      const contents = [];
      
      // Add history if present
      if (history && history.length > 0) {
        history.forEach(msg => {
          contents.push({
            role: msg.role,
            parts: [{ text: msg.content }]
          });
        });
      }

      // Add current prompt
      contents.push({
        role: 'user',
        parts: [{ text: prompt }]
      });

      const payload: any = {
        contents: contents,
        generationConfig: {
          temperature: 0.8, // Slightly higher for creativity/personality
          maxOutputTokens: 1000,
        }
      };

      if (systemPrompt) {
        payload.systemInstruction = {
          parts: [{ text: systemPrompt }]
        };
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error?.message || 'Failed to fetch response');
      }

      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (err: any) {
      clearTimeout(timeoutId);
      throw err;
    }
  };

  // --- Handlers ---

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const messages = parseWhatsAppChat(text);
        
        if (messages.length === 0) {
          setError("No valid messages found. Check if the text file is a valid WhatsApp export.");
          return;
        }

        // Extract unique senders
        const senders = Array.from(new Set(messages.map(m => m.sender)));
        setParsedMessages(messages);
        setParticipants(senders);
        setAppState('selection');
        setError(null);
      } catch (err) {
        setError("Failed to parse file.");
      }
    };
    reader.readAsText(file);
  };

  const handleAnalyzePersona = async (persona: string) => {
    setSelectedPersona(persona);
    setAppState('analyzing');
    setIsLoading(true);
    setAnalysisProgress('Extracting message samples...');

    try {
      // 1. Filter messages from this user
      const userMessages = parsedMessages
        .filter(m => m.sender === persona)
        .map(m => m.content)
        .filter(c => !c.includes("Media omitted") && !c.includes("message deleted") && c.length > 2); // Filter junk

      // 2. Select a representative sample (last 200 messages or random distribution)
      // We take a chunk of the most recent ones to capture current personality
      const sampleSize = Math.min(userMessages.length, 400);
      const sampleText = userMessages.slice(-sampleSize).join('\n');

      setAnalysisProgress('Consulting Gemini to build psychological profile...');

      // 3. Ask Gemini to generate the system prompt
      const analysisPrompt = `
        I have a log of chat messages from a user named "${persona}". 
        Your goal is to create a "System Persona" so an AI can roleplay exactly like this person.
        
        Analyze the following message samples for:
        1. **Tone & Emotion**: Are they cynical, cheerful, anxious, brief, verbose, sarcastic?
        2. **Writing Style**: Do they use lowercase, emojis, slang, abbreviations (u, r, lol), specific punctuation habits?
        3. **Language**: What language or mix of languages (e.g., Hinglish) do they use?
        4. **Personality**: Infer their personality traits based on what they say.

        Here are the message samples:
        """
        ${sampleText}
        """

        OUTPUT INSTRUCTION:
        Write a concise but highly specific SYSTEM PROMPT (2-3 paragraphs) that commands an LLM to become this person. 
        Start with "You are ${persona}..." 
        Explicitly instruct the model on how to format text (e.g., "never use capital letters", "use excessive emojis").
        Do not include the analysis itself in the output, ONLY the prompt for the AI.
      `;

      const generatedSystemPrompt = await callGemini(analysisPrompt);
      
      setSystemInstruction(generatedSystemPrompt);
      setAppState('chat');
      setChatHistory([{ role: 'model', content: `(Connected as ${persona}) Hey, what's up?` }]);
    } catch (err: any) {
      setError(`Analysis failed: ${err.message}`);
      setAppState('selection');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const newMsg: Message = { role: 'user', content: inputMessage, timestamp: Date.now() };
    const updatedHistory = [...chatHistory, newMsg];
    
    setChatHistory(updatedHistory);
    setInputMessage('');
    setIsLoading(true);

    try {
      // We only send the last 10 messages to keep context window clean and focused
      const contextHistory = updatedHistory.slice(-10);
      const reply = await callGemini(inputMessage, systemInstruction, contextHistory);
      
      setChatHistory(prev => [...prev, { role: 'model', content: reply, timestamp: Date.now() }]);
    } catch (err: any) {
      setError("Failed to send message: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const resetApp = () => {
    setAppState('setup');
    setParsedMessages([]);
    setParticipants([]);
    setSelectedPersona(null);
    setChatHistory([]);
    setSystemInstruction('');
    setError(null);
  };

  // --- Render Steps ---

  const renderSetup = () => (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded-xl shadow-lg border border-slate-100">
      <div className="flex justify-center mb-6">
        <div className="p-3 bg-blue-100 rounded-full">
          <Key className="w-8 h-8 text-blue-600" />
        </div>
      </div>
      <h2 className="text-2xl font-bold text-center text-slate-800 mb-2">API Key Required</h2>
      <p className="text-center text-slate-500 mb-6 text-sm">
        To power the AI persona, we need a Google Gemini API key. It is stored only in your browser's memory.
      </p>
      
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Gemini API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="AIzaSy..."
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
          />
        </div>
        <button
          onClick={() => {
            if (apiKey.length > 10) setAppState('upload');
            else setError("Please enter a valid API key");
          }}
          disabled={apiKey.length < 10}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue
        </button>
      </div>
    </div>
  );

  const renderUpload = () => (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded-xl shadow-lg border border-slate-100 text-center">
      <div className="flex justify-center mb-6">
        <div className="p-3 bg-green-100 rounded-full">
          <Upload className="w-8 h-8 text-green-600" />
        </div>
      </div>
      <h2 className="text-2xl font-bold text-slate-800 mb-2">Upload Chat Log</h2>
      <p className="text-slate-500 mb-6 text-sm">
        Export a chat from WhatsApp (without media) and upload the <code>.txt</code> file here.
      </p>
      
      <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 hover:bg-slate-50 transition-colors cursor-pointer relative">
        <input 
          type="file" 
          accept=".txt"
          onChange={handleFileUpload}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div className="flex flex-col items-center pointer-events-none">
          <MessageSquare className="w-10 h-10 text-slate-400 mb-3" />
          <span className="text-sm font-medium text-slate-600">Click or Drag .txt file</span>
        </div>
      </div>

      <div className="mt-6 flex justify-between items-center text-xs text-slate-400">
        <span>Privacy: Files are processed locally.</span>
        <button onClick={() => setAppState('setup')} className="text-blue-500 hover:underline">Back</button>
      </div>
    </div>
  );

  const renderSelection = () => (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded-xl shadow-lg border border-slate-100">
      <h2 className="text-2xl font-bold text-slate-800 mb-4 text-center">Who to Clone?</h2>
      <p className="text-center text-slate-500 mb-6 text-sm">
        We found {participants.length} participants. Select one to analyze and mimic.
      </p>
      
      <div className="space-y-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
        {participants.map((p, idx) => (
          <button
            key={idx}
            onClick={() => handleAnalyzePersona(p)}
            className="w-full flex items-center p-3 hover:bg-purple-50 border border-slate-200 rounded-lg transition-all group"
          >
            <div className="w-10 h-10 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center font-bold mr-4 group-hover:bg-purple-200">
              {p.charAt(0).toUpperCase()}
            </div>
            <div className="text-left flex-1">
              <div className="font-medium text-slate-800">{p}</div>
              <div className="text-xs text-slate-500">
                {parsedMessages.filter(m => m.sender === p).length} messages
              </div>
            </div>
            <Sparkles className="w-4 h-4 text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>

      <button onClick={() => setAppState('upload')} className="w-full mt-6 py-2 text-slate-500 text-sm hover:text-slate-800">
        Choose different file
      </button>
    </div>
  );

  const renderAnalyzing = () => (
    <div className="max-w-md mx-auto mt-10 p-8 bg-white rounded-xl shadow-lg border border-slate-100 text-center">
      <div className="animate-spin mb-6 mx-auto w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full"></div>
      <h3 className="text-xl font-bold text-slate-800 mb-2">Analyzing Persona</h3>
      <p className="text-slate-500 text-sm animate-pulse">{analysisProgress}</p>
    </div>
  );

  const renderChat = () => (
    <div className="flex flex-col h-[600px] w-full max-w-2xl mx-auto bg-white rounded-xl shadow-2xl overflow-hidden border border-slate-200">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 p-4 flex items-center justify-between">
        <div className="flex items-center">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold shadow-sm">
            {selectedPersona?.charAt(0).toUpperCase()}
          </div>
          <div className="ml-3">
            <h3 className="font-bold text-slate-800">{selectedPersona} (AI)</h3>
            <div className="flex items-center text-xs text-green-500">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-1"></span>
              Online
            </div>
          </div>
        </div>
        <div className="flex gap-2">
            <button 
                onClick={() => {
                   if(confirm("This will clear the current chat context. Continue?")) {
                       setChatHistory([]);
                   }
                }}
                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                title="Clear Chat"
            >
                <Trash2 className="w-5 h-5" />
            </button>
            <button 
                onClick={resetApp}
                className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-colors"
                title="Reset App"
            >
                <RefreshCw className="w-5 h-5" />
            </button>
        </div>
      </div>

      {/* Messages Area */}
      <div 
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50"
      >
        {chatHistory.map((msg, idx) => {
          const isUser = msg.role === 'user';
          return (
            <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div 
                className={`
                  max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm
                  ${isUser 
                    ? 'bg-blue-600 text-white rounded-tr-none' 
                    : 'bg-white text-slate-800 border border-slate-100 rounded-tl-none'
                  }
                `}
              >
                <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                <div className={`text-[10px] mt-1 opacity-70 ${isUser ? 'text-blue-100' : 'text-slate-400'}`}>
                  {new Date(msg.timestamp || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </div>
              </div>
            </div>
          );
        })}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-100 rounded-2xl rounded-tl-none px-4 py-3 shadow-sm">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '0ms'}}></div>
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></div>
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-slate-100">
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-4 py-3 bg-slate-100 border-transparent focus:bg-white focus:border-blue-300 focus:ring-2 focus:ring-blue-100 rounded-full transition-all outline-none text-slate-800"
          />
          <button 
            type="submit"
            disabled={!inputMessage.trim() || isLoading}
            className="p-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg active:scale-95"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );

  // --- Main Render ---

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-blue-100">
      <nav className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-gradient-to-tr from-blue-600 to-indigo-600 text-white p-2 rounded-lg">
            <MessageSquare className="w-5 h-5" />
          </div>
          <span className="font-bold text-xl tracking-tight text-slate-800">Persona<span className="text-blue-600">Clone</span></span>
        </div>
        {apiKey && (
            <div className="text-xs font-mono bg-slate-100 px-2 py-1 rounded text-slate-500">
                API Active
            </div>
        )}
      </nav>

      <main className="container mx-auto px-4 pb-10">
        {error && (
          <div className="max-w-md mx-auto mt-6 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg flex items-start gap-3 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>{error}</div>
            <button onClick={() => setError(null)} className="ml-auto hover:text-red-800">×</button>
          </div>
        )}

        {appState === 'setup' && renderSetup()}
        {appState === 'upload' && renderUpload()}
        {appState === 'selection' && renderSelection()}
        {appState === 'analyzing' && renderAnalyzing()}
        {appState === 'chat' && (
            <div className="mt-8">
                {renderChat()}
                {/* Debug Info Toggle - optional */}
                <div className="max-w-2xl mx-auto mt-4 text-center">
                    <details className="text-xs text-slate-400 cursor-pointer">
                        <summary className="hover:text-slate-600 transition-colors">View System Persona (Debug)</summary>
                        <div className="mt-2 p-4 bg-slate-100 rounded text-left font-mono whitespace-pre-wrap border border-slate-200">
                            {systemInstruction}
                        </div>
                    </details>
                </div>
            </div>
        )}
      </main>
    </div>
  );
}