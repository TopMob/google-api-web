"use client";

import React from "react";
import { Bot, Key, Terminal, HelpCircle } from "lucide-react";

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
  expires_at?: string;
  created_at: string;
}

interface SidebarProps {
  activeTab: "playground" | "keys" | "logs" | "faq";
  setActiveTab: (tab: "playground" | "keys" | "logs" | "faq") => void;
  gatewayUrl: string;
  gatewayStatus: "online" | "offline" | "checking";
  playgroundKey: string;
  setPlaygroundKey: (key: string) => void;
  apiKeys: ApiKey[];
}

export default function Sidebar({
  activeTab,
  setActiveTab,
  gatewayUrl,
  gatewayStatus,
  playgroundKey,
  setPlaygroundKey,
  apiKeys
}: SidebarProps) {
  return (
    <aside className="w-72 border-r border-zinc-800 bg-[#090a0f] flex flex-col justify-between p-5 select-none shrink-0 font-sans">
      <div className="space-y-7">
        {/* Logo Section */}
        <div className="flex items-center gap-3 px-1">
          <div className="relative">
            <img
              src="/logo.png"
              alt="Gemini Web2API Logo"
              className="h-9 w-9 rounded-lg border border-cyan-500/30 shadow-[0_0_10px_rgba(6,182,212,0.15)] object-cover"
            />
            <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-500 opacity-20 blur-sm -z-10" />
          </div>
          <div>
            <h1 className="text-xs font-bold tracking-tight text-white font-mono">
              GEMINI <span className="text-cyan-400">WEB2API</span>
            </h1>
            <p className="text-[8px] text-zinc-500 font-mono tracking-widest uppercase">Developer Portal</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="space-y-1">
          <p className="text-[9px] font-mono tracking-widest text-zinc-500 uppercase px-2 mb-2">Workspace</p>
          {[
            { id: "playground", label: "Playground Chat", icon: Bot },
            { id: "keys", label: "API Keys", icon: Key },
            { id: "logs", label: "Real-time Logs", icon: Terminal },
            { id: "faq", label: "Cookie & Setup", icon: HelpCircle }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded text-xs font-mono transition-all duration-150 border text-left ${
                  isActive
                    ? "bg-zinc-900 border-zinc-800 text-cyan-400 font-medium"
                    : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/30"
                }`}
              >
                <Icon size={14} className={isActive ? "text-cyan-400" : "text-zinc-400"} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Upstream Status Panel */}
        <div className="space-y-2">
          <p className="text-[9px] font-mono tracking-widest text-zinc-500 uppercase px-2">Connection Status</p>
          <div className="p-3 bg-[#0d0e12] border border-zinc-850 rounded font-mono">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-400">Local Gateway</span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    gatewayStatus === "online"
                      ? "bg-emerald-500 pulse-glow-green"
                      : gatewayStatus === "offline"
                        ? "bg-rose-500 pulse-glow-red"
                        : "bg-amber-500 animate-pulse"
                  }`}
                />
                <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-300">{gatewayStatus}</span>
              </div>
            </div>
            <div className="text-[9px] text-zinc-500 font-mono mt-1 truncate select-all">{gatewayUrl}</div>
          </div>
        </div>
      </div>

      {/* Footer Playground Key */}
      <div className="space-y-2 border-t border-zinc-900 pt-4">
        <p className="text-[9px] font-mono tracking-widest text-zinc-500 uppercase px-2">Active Bearer Key</p>
        <div className="relative">
          <select
            value={playgroundKey}
            onChange={(e) => setPlaygroundKey(e.target.value)}
            className="w-full bg-[#0d0e12] border border-zinc-850 hover:border-zinc-700 rounded px-3 py-2 text-xs font-mono text-zinc-300 outline-none transition cursor-pointer appearance-none"
          >
            <option value="sk-personal-gw">sk-personal-gw (Admin)</option>
            {apiKeys
              .filter((k) => k.active)
              .map((k) => (
                <option key={k.id} value={k.key}>
                  {k.name} ({k.key.substring(3, 11)}...)
                </option>
              ))}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>
    </aside>
  );
}
