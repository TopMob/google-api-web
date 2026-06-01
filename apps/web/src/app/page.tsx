"use client";

import { useState, useEffect, useRef } from "react";
import { 
  Sparkles, 
  Send, 
  Layers, 
  Key, 
  Copy, 
  Check, 
  RefreshCw,
  Terminal,
  Cpu,
  Bot,
  User,
  Shield,
  PlusCircle,
  Activity,
  Clock,
  Settings,
  Plus
} from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Project {
  id: string;
  name: string;
  created_at: string;
}

interface ApiKey {
  id: string;
  key: string;
  project_id: string;
  name: string;
  active: boolean;
  projects?: { name: string };
  allowed_models?: string[];
  daily_requests_limit?: number;
  daily_tokens_limit?: number;
  rate_limit_rpm?: number;
}

interface UsageLog {
  id: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  duration_ms: number;
  status_code: number;
  created_at: string;
  projects?: { name: string };
  api_keys?: { name: string };
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<"playground" | "keys" | "logs">("playground");
  const [gatewayStatus, setGatewayStatus] = useState<"online" | "offline" | "checking">("checking");
  const [gatewayUrl, setGatewayUrl] = useState("http://127.0.0.1:8081");
  const [models, setModels] = useState<string[]>([
    "gemini-3.5-flash",
    "gemini-3.5-flash-thinking",
    "gemini-3.1-pro",
    "gemini-auto",
    "gemini-3.5-flash-thinking-lite",
    "gemini-flash-lite"
  ]);
  const [selectedModel, setSelectedModel] = useState("gemini-3.5-flash");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  
  const [stats, setStats] = useState({
    requests: 0,
    estimatedTokens: 0,
    successRate: 100,
    activeTime: "0m"
  });

  const [projects, setProjects] = useState<Project[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [recentLogs, setRecentLogs] = useState<UsageLog[]>([]);
  
  const [newProjectName, setNewProjectName] = useState("");
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyProjectId, setNewKeyProjectId] = useState("");
  const [dailyRequestsLimit, setDailyRequestsLimit] = useState("");
  const [dailyTokensLimit, setDailyTokensLimit] = useState("");
  const [rateLimitRpm, setRateLimitRpm] = useState("");
  const [playgroundKey, setPlaygroundKey] = useState("sk-personal-gw");
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const checkHealth = async () => {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      if (data.status === "online") {
        setGatewayStatus("online");
        setGatewayUrl(data.gatewayUrl);
      } else {
        setGatewayStatus("offline");
      }
    } catch {
      setGatewayStatus("offline");
    }
  };

  const fetchModels = async () => {
    try {
      const res = await fetch("/api/v1/models");
      if (res.ok) {
        const data = await res.json();
        if (data.data && Array.isArray(data.data)) {
          setModels(data.data.map((m: any) => m.id));
        }
      }
    } catch {}
  };

  const fetchDbData = async () => {
    try {
      const projRes = await fetch("/api/projects");
      if (projRes.ok) {
        const projData = await projRes.json();
        setProjects(projData);
        if (projData.length > 0 && !newKeyProjectId) {
          setNewKeyProjectId(projData[0].id);
        }
      }

      const keysRes = await fetch("/api/keys");
      if (keysRes.ok) {
        setApiKeys(await keysRes.json());
      }

      const statsRes = await fetch("/api/stats");
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(prev => ({
          ...prev,
          requests: statsData.totalRequests,
          estimatedTokens: statsData.totalTokens,
          successRate: statsData.successRate
        }));
        setRecentLogs(statsData.recentLogs);
      }
    } catch {}
  };

  useEffect(() => {
    checkHealth();
    fetchModels();
    fetchDbData();

    const interval = setInterval(() => {
      checkHealth();
      fetchDbData();
      
      const diffMins = Math.floor((Date.now() - startTimeRef.current) / 60000);
      setStats(prev => ({
        ...prev,
        activeTime: `${diffMins}m`
      }));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProjectName })
      });
      if (res.ok) {
        setNewProjectName("");
        fetchDbData();
      }
    } catch {}
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim() || !newKeyProjectId) return;
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          name: newKeyName, 
          project_id: newKeyProjectId,
          daily_requests_limit: dailyRequestsLimit || null,
          daily_tokens_limit: dailyTokensLimit || null,
          rate_limit_rpm: rateLimitRpm || null
        })
      });
      if (res.ok) {
        setNewKeyName("");
        setDailyRequestsLimit("");
        setDailyTokensLimit("");
        setRateLimitRpm("");
        fetchDbData();
      }
    } catch {}
  };

  const handleToggleKey = async (id: string, currentStatus: boolean) => {
    try {
      const res = await fetch("/api/keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active: !currentStatus })
      });
      if (res.ok) {
        fetchDbData();
      }
    } catch {}
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg: Message = { role: "user", content: input };
    const newMessages = [...messages, userMsg];
    
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    const assistantMsgIndex = newMessages.length;
    setMessages(prev => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${playgroundKey}`
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: newMessages,
          stream: true,
        }),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(dataStr);
              const content = parsed.choices?.[0]?.delta?.content || "";
              if (content) {
                accumulated += content;
                setMessages(prev => {
                  const next = [...prev];
                  if (next[assistantMsgIndex]) {
                    next[assistantMsgIndex] = {
                      role: "assistant",
                      content: accumulated
                    };
                  }
                  return next;
                });
              }
            } catch {}
          }
        }
      }

      fetchDbData();

    } catch {
      setMessages(prev => {
        const next = [...prev];
        if (next[assistantMsgIndex]) {
          next[assistantMsgIndex] = {
            role: "assistant",
            content: "Error: Failed to fetch response from local gateway."
          };
        }
        return next;
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#07080d] overflow-hidden text-slate-200">
      <aside className="w-80 border-r border-[#1a1d2e] bg-[#0c0e18] flex flex-col justify-between p-6">
        <div className="space-y-8">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Gemini Web2API Logo" className="h-10 w-10 rounded-xl border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.25)] hover:scale-105 transition-all duration-300 object-cover" />
            <div>
              <h1 className="text-sm font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
                Gemini Web2API
              </h1>
              <p className="text-[8px] text-slate-500 font-bold uppercase tracking-widest">
                OPENAI-COMPATIBLE
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <button
              onClick={() => setActiveTab("playground")}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition ${
                activeTab === "playground" ? "bg-blue-600/10 text-blue-400 border border-blue-500/20" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Bot size={16} />
              <span>Playground Chat</span>
            </button>
            <button
              onClick={() => setActiveTab("keys")}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition ${
                activeTab === "keys" ? "bg-blue-600/10 text-blue-400 border border-blue-500/20" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Key size={16} />
              <span>Projects & API Keys</span>
            </button>
            <button
              onClick={() => setActiveTab("logs")}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition ${
                activeTab === "logs" ? "bg-blue-600/10 text-blue-400 border border-blue-500/20" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Terminal size={16} />
              <span>Real-time Usage Logs</span>
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2 block">
                UPSTREAM CONNECTION
              </label>
              <div className="flex items-center justify-between p-3.5 bg-[#121626] border border-[#1e233b] rounded-xl">
                <div className="space-y-1">
                  <div className="text-xs font-semibold">Fastify Node.js</div>
                  <div className="text-[10px] text-slate-400 font-mono">{gatewayUrl}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${
                    gatewayStatus === "online" 
                      ? "bg-emerald-500 pulse-glow-green" 
                      : gatewayStatus === "offline" 
                      ? "bg-rose-500 pulse-glow-red" 
                      : "bg-amber-500 animate-pulse"
                  }`} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    {gatewayStatus}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                  SELECT MODEL
                </label>
                <button 
                  onClick={fetchModels} 
                  className="text-slate-400 hover:text-blue-400 transition-colors"
                  title="Refresh models"
                >
                  <RefreshCw size={12} />
                </button>
              </div>
              <div className="relative">
                <Cpu size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full bg-[#121626] border border-[#1e233b] hover:border-blue-500/50 rounded-xl pl-10 pr-4 py-3 text-xs font-semibold text-slate-200 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 cursor-pointer appearance-none animate-none"
                >
                  {models.map((m) => (
                    <option key={m} value={m} className="bg-[#0c0e18]">
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2 block">
                PLAYGROUND API KEY
              </label>
              <div className="relative">
                <Key size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <select
                  value={playgroundKey}
                  onChange={(e) => setPlaygroundKey(e.target.value)}
                  className="w-full bg-[#121626] border border-[#1e233b] hover:border-blue-500/50 rounded-xl pl-10 pr-4 py-3 text-xs font-semibold text-slate-200 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500 cursor-pointer appearance-none animate-none"
                >
                  <option value="sk-personal-gw" className="bg-[#0c0e18]">sk-personal-gw (Admin Bypass)</option>
                  {apiKeys.filter(k => k.active).map((k) => (
                    <option key={k.id} value={k.key} className="bg-[#0c0e18]">
                      {k.name} ({k.key.substring(0, 15)}...)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2 block">
                LOCAL API ENDPOINT
              </label>
              <div className="p-3 bg-[#121626] border border-[#1e233b] rounded-xl space-y-2">
                <div className="text-[11px] font-mono text-blue-400 break-all select-all">
                  http://localhost:3000/api/v1
                </div>
                <p className="text-[9px] text-slate-500 leading-relaxed">
                  Use this URL in your other local projects as OpenAI baseURL.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-6 border-t border-[#1a1d2e]">
          <div className="flex items-center gap-3 p-3 bg-blue-500/5 border border-blue-500/10 rounded-xl">
            <Shield size={16} className="text-blue-400 shrink-0" />
            <div className="text-[9px] text-slate-400 leading-normal">
              CORS Bypass active. Upstream requests mapped to Gemini Web StreamGenerate.
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col justify-between bg-[#08090e]">
        <header className="h-16 border-b border-[#1a1d2e] bg-[#0c0e18]/80 backdrop-blur px-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-sm font-bold flex items-center gap-2">
              <Bot size={16} className="text-blue-400" />
              <span>Gateway Playroom</span>
            </div>
            <span className="h-4 w-px bg-[#1a1d2e]" />
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <Terminal size={12} className="text-slate-500" />
              <span>Model: <span className="font-mono font-bold text-slate-200">{selectedModel}</span></span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-6">
              <div className="text-right">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Total Requests</div>
                <div className="text-xs font-bold text-slate-200">{stats.requests}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Total Tokens</div>
                <div className="text-xs font-bold text-slate-200">{stats.estimatedTokens}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Success Rate</div>
                <div className="text-xs font-bold text-slate-200">{stats.successRate}%</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Session Time</div>
                <div className="text-xs font-bold text-slate-200">{stats.activeTime}</div>
              </div>
            </div>
          </div>
        </header>

        {activeTab === "playground" && (
          <>
            <div className="flex-grow overflow-y-auto px-8 py-8 space-y-6 custom-scrollbar">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-6">
                  <div className="p-4 bg-blue-600/5 border border-blue-500/10 rounded-2xl">
                    <Sparkles size={36} className="text-blue-400" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-lg font-bold">Personal AI Gateway Chat</h2>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Start typing to test the local Gemini Web adapter connection. This UI connects directly to your Node.js instance under the hood.
                    </p>
                  </div>
                </div>
              ) : (
                messages.map((msg: Message, idx: number) => (
                  <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] flex gap-3.5 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                      <div className={`h-8 w-8 rounded-lg shrink-0 flex items-center justify-center border ${
                        msg.role === "user" 
                          ? "bg-blue-600/10 border-blue-500/20 text-blue-400" 
                          : "bg-[#121626] border-[#1e233b] text-slate-400"
                      }`}>
                        {msg.role === "user" ? <User size={14} /> : <Bot size={14} />}
                      </div>
                      <div className={`rounded-2xl px-5 py-3.5 text-xs leading-relaxed ${
                        msg.role === "user"
                          ? "bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-medium shadow-lg shadow-blue-900/10"
                          : "bg-[#11131e] border border-[#1e2235] text-slate-100"
                      }`}>
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex justify-start">
                  <div className="max-w-[75%] flex gap-3.5 flex-row">
                    <div className="h-8 w-8 rounded-lg shrink-0 flex items-center justify-center border bg-[#121626] border-[#1e233b] text-slate-400">
                      <Bot size={14} />
                    </div>
                    <div className="rounded-2xl px-5 py-3.5 text-xs bg-[#11131e] border border-[#1e2235] text-slate-400 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-1.5 w-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-1.5 w-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            <div className="px-8 pb-8 bg-gradient-to-t from-[#08090e] via-[#08090e] to-transparent pt-4">
              <form onSubmit={handleSubmit} className="relative flex items-center bg-[#0c0e18] border border-[#1e233b] focus-within:border-blue-500/80 rounded-2xl p-2.5 shadow-xl shadow-black/20 transition-all duration-300">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={gatewayStatus === "online" ? "Ask Gemini anything..." : "Waiting for local Node.js server..."}
                  disabled={isLoading || gatewayStatus !== "online"}
                  className="flex-grow bg-transparent border-0 outline-none text-xs px-4 py-3 placeholder-slate-500 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim() || gatewayStatus !== "online"}
                  className="bg-blue-600 hover:bg-blue-500 text-white rounded-xl p-3 text-xs font-semibold transition-all duration-300 disabled:opacity-40 disabled:hover:bg-blue-600 shrink-0"
                >
                  <Send size={14} />
                </button>
              </form>
            </div>
          </>
        )}

        {activeTab === "keys" && (
          <div className="flex-grow overflow-y-auto px-8 py-8 space-y-8 custom-scrollbar">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-[#0c0e18] border border-[#1a1d2e] rounded-2xl p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-[#1e233b] pb-4">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <Layers size={16} className="text-blue-400" />
                    <span>Projects</span>
                  </h3>
                </div>
                
                <form onSubmit={handleCreateProject} className="flex gap-2">
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="New project name..."
                    className="flex-grow bg-[#121626] border border-[#1e233b] focus:border-blue-500/80 rounded-xl px-4 py-2.5 text-xs outline-none text-slate-200"
                  />
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-500 text-white rounded-xl px-4 py-2.5 text-xs font-semibold transition flex items-center gap-1 shrink-0"
                  >
                    <Plus size={14} />
                    <span>Create</span>
                  </button>
                </form>

                <div className="space-y-2.5 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                  {projects.map((p) => (
                    <div key={p.id} className="flex items-center justify-between p-3.5 bg-[#121626]/50 border border-[#1e233b]/60 rounded-xl">
                      <div className="space-y-0.5">
                        <div className="text-xs font-bold text-slate-200">{p.name}</div>
                        <div className="text-[9px] text-slate-500 font-mono select-all break-all">{p.id}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#0c0e18] border border-[#1a1d2e] rounded-2xl p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-[#1e233b] pb-4">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <Key size={16} className="text-blue-400" />
                    <span>Generate API Key</span>
                  </h3>
                </div>

                <form onSubmit={handleCreateKey} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                      Key Description / Name
                    </label>
                    <input
                      type="text"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="e.g. Production Key, Test Integration..."
                      className="w-full bg-[#121626] border border-[#1e233b] focus:border-blue-500/80 rounded-xl px-4 py-2.5 text-xs outline-none text-slate-200"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                      Target Project
                    </label>
                    <select
                      value={newKeyProjectId}
                      onChange={(e) => setNewKeyProjectId(e.target.value)}
                      className="w-full bg-[#121626] border border-[#1e233b] focus:border-blue-500/80 rounded-xl px-4 py-2.5 text-xs outline-none text-slate-200 cursor-pointer"
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id} className="bg-[#0c0e18]">
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1.5">
                      <label className="text-[9px] uppercase font-bold tracking-wider text-slate-400 block">
                        Daily Requests
                      </label>
                      <input
                        type="number"
                        value={dailyRequestsLimit}
                        onChange={(e) => setDailyRequestsLimit(e.target.value)}
                        placeholder="Unlimited"
                        className="w-full bg-[#121626] border border-[#1e233b] focus:border-blue-500/80 rounded-xl px-3 py-2 text-[11px] outline-none text-slate-200"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[9px] uppercase font-bold tracking-wider text-slate-400 block">
                        Daily Tokens
                      </label>
                      <input
                        type="number"
                        value={dailyTokensLimit}
                        onChange={(e) => setDailyTokensLimit(e.target.value)}
                        placeholder="Unlimited"
                        className="w-full bg-[#121626] border border-[#1e233b] focus:border-blue-500/80 rounded-xl px-3 py-2 text-[11px] outline-none text-slate-200"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[9px] uppercase font-bold tracking-wider text-slate-400 block">
                        RPM Rate Limit
                      </label>
                      <input
                        type="number"
                        value={rateLimitRpm}
                        onChange={(e) => setRateLimitRpm(e.target.value)}
                        placeholder="Unlimited"
                        className="w-full bg-[#121626] border border-[#1e233b] focus:border-blue-500/80 rounded-xl px-3 py-2 text-[11px] outline-none text-slate-200"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-3 text-xs font-semibold transition flex items-center justify-center gap-1.5"
                  >
                    <PlusCircle size={14} />
                    <span>Generate Key</span>
                  </button>
                </form>
              </div>
            </div>

            <div className="bg-[#0c0e18] border border-[#1a1d2e] rounded-2xl p-6 space-y-6">
              <h3 className="text-sm font-bold border-b border-[#1e233b] pb-4">
                Active API Keys
              </h3>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#1e233b] text-slate-500 text-[10px] uppercase font-bold tracking-wider">
                      <th className="pb-3 pr-4">Name</th>
                      <th className="pb-3 px-4">Project</th>
                      <th className="pb-3 px-4">API Key Value</th>
                      <th className="pb-3 px-4">Limits (Req/Tok/RPM)</th>
                      <th className="pb-3 px-4">Status</th>
                      <th className="pb-3 pl-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e233b]/40 text-xs">
                    {apiKeys.map((k) => (
                      <tr key={k.id} className="hover:bg-[#121626]/20 transition-colors">
                        <td className="py-4 pr-4 font-bold text-slate-200">{k.name}</td>
                        <td className="py-4 px-4 text-slate-400">{k.projects?.name || "Unknown"}</td>
                        <td className="py-4 px-4 font-mono text-[11px] text-blue-400">
                          <span className="flex items-center gap-2 select-all">
                            {k.key.substring(0, 18)}...
                            <button
                              onClick={() => copyText(k.key)}
                              className="text-slate-500 hover:text-blue-400 transition shrink-0"
                            >
                              {copiedKey === k.key ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                            </button>
                          </span>
                        </td>
                        <td className="py-4 px-4 text-slate-400 font-mono text-[11px]">
                          {k.daily_requests_limit || "∞"} / {k.daily_tokens_limit || "∞"} / {k.rate_limit_rpm || "∞"}
                        </td>
                        <td className="py-4 px-4">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            k.active ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                          }`}>
                            <span className={`h-1 w-1 rounded-full ${k.active ? "bg-emerald-400" : "bg-rose-400"}`} />
                            {k.active ? "Active" : "Disabled"}
                          </span>
                        </td>
                        <td className="py-4 pl-4 text-right">
                          <button
                            onClick={() => handleToggleKey(k.id, k.active)}
                            className={`text-[10px] font-bold tracking-wider uppercase px-3 py-1.5 rounded-lg transition border ${
                              k.active 
                                ? "border-rose-500/20 text-rose-400 hover:bg-rose-500/10" 
                                : "border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10"
                            }`}
                          >
                            {k.active ? "Deactivate" : "Activate"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === "logs" && (
          <div className="flex-grow overflow-y-auto px-8 py-8 space-y-6 custom-scrollbar">
            <div className="bg-[#0c0e18] border border-[#1a1d2e] rounded-2xl p-6 space-y-6 flex flex-col h-full">
              <div className="flex items-center justify-between border-b border-[#1e233b] pb-4 shrink-0">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Terminal size={16} className="text-blue-400" />
                  <span>Real-time Rolling Analytics</span>
                </h3>
                <span className="text-[10px] text-slate-500 font-mono">Centralized Gateway Logs</span>
              </div>

              <div className="flex-grow overflow-y-auto space-y-3 custom-scrollbar pr-1">
                {recentLogs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 py-12">
                    <Activity size={24} className="mb-2 animate-pulse" />
                    <p className="text-xs">No gateway requests detected yet.</p>
                  </div>
                ) : (
                  recentLogs.map((l) => (
                    <div key={l.id} className="p-4 bg-[#121626]/30 border border-[#1e233b]/60 rounded-xl space-y-3 hover:border-blue-500/30 transition-all duration-300">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                            l.status_code >= 200 && l.status_code < 300 
                              ? "bg-emerald-500/10 text-emerald-400" 
                              : "bg-rose-500/10 text-rose-400"
                          }`}>
                            {l.status_code}
                          </span>
                          <span className="text-xs font-bold text-slate-200 font-mono">{l.model}</span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                          <Clock size={10} />
                          {new Date(l.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-1.5 text-[10px] font-mono text-slate-400 border-t border-[#1e233b]/30">
                        <div>
                          <span className="text-slate-500 uppercase block text-[8px] font-bold">Project</span>
                          <span className="text-slate-300 font-semibold">{l.projects?.name || "N/A"}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 uppercase block text-[8px] font-bold">API Key</span>
                          <span className="text-slate-300 font-semibold">{l.api_keys?.name || "N/A"}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 uppercase block text-[8px] font-bold">Tokens</span>
                          <span className="text-slate-300 font-semibold">{l.total_tokens} total</span>
                        </div>
                        <div>
                          <span className="text-slate-500 uppercase block text-[8px] font-bold">Latency</span>
                          <span className="text-slate-300 font-semibold">{l.duration_ms}ms</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
