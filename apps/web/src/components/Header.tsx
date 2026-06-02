"use client";

import React, { useState } from "react";
import { Bot, Key, Terminal, HelpCircle, Cpu, RefreshCw, Copy, Check } from "lucide-react";

interface HeaderProps {
  activeTab: "playground" | "keys" | "logs" | "faq";
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: string[];
  fetchModels: () => Promise<void>;
  stats: {
    requests: number;
    estimatedTokens: number;
    successRate: number;
    activeTime: string;
  };
}

export default function Header({
  activeTab,
  selectedModel,
  setSelectedModel,
  models,
  fetchModels,
  stats,
}: HeaderProps) {
  const [copiedModel, setCopiedModel] = useState(false);

  const handleCopyModel = () => {
    navigator.clipboard.writeText(selectedModel);
    setCopiedModel(true);
    setTimeout(() => setCopiedModel(false), 2000);
  };
  const getTabInfo = () => {
    switch (activeTab) {
      case "playground":
        return { label: "Gateway Playroom", icon: Bot };
      case "keys":
        return { label: "API Keys", icon: Key };
      case "logs":
        return { label: "Real-time Analytics", icon: Terminal };
      case "faq":
        return { label: "Documentation", icon: HelpCircle };
    }
  };

  const TabInfo = getTabInfo();
  const Icon = TabInfo.icon;

  return (
    <header className="h-14 border-b border-zinc-800 bg-[#090a0f] px-6 flex items-center justify-between font-sans select-none shrink-0">
      {/* Tab Indicator & Model Selector */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wider font-mono">
          <Icon size={14} className="text-cyan-400" />
          <span>{TabInfo.label}</span>
        </div>

        <span className="h-4 w-px bg-zinc-800" />

        {/* Model Dropdown */}
        <div className="flex items-center gap-2 text-xs">
          <Cpu size={13} className="text-zinc-500" />
          <span className="text-zinc-400 font-mono text-[11px]">Model:</span>
          <div className="relative flex items-center">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-[#0d0e12] border border-zinc-850 hover:border-zinc-700 rounded pl-2.5 pr-7 py-1 text-[11px] font-mono text-zinc-300 outline-none transition cursor-pointer appearance-none"
            >
              {models.map((m) => (
                <option key={m} value={m} className="bg-[#090a0f] font-mono">
                  {m}
                </option>
              ))}
            </select>
            <div className="absolute right-2 pointer-events-none text-zinc-500">
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
          <button
            onClick={handleCopyModel}
            className="bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 hover:border-cyan-500/40 rounded px-2.5 py-1 text-[10px] font-mono transition flex items-center gap-1.5 shrink-0"
            title="Copy selected model name"
          >
            {copiedModel ? (
              <>
                <Check size={11} className="text-emerald-400" />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <Copy size={11} />
                <span>Copy Model</span>
              </>
            )}
          </button>
          <button
            onClick={fetchModels}
            className="text-zinc-500 hover:text-cyan-400 transition-colors p-1"
            title="Refresh models"
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {/* Live Stats */}
      <div className="flex items-center gap-5">
        {[
          { label: "Requests", value: stats.requests },
          { label: "Tokens", value: stats.estimatedTokens },
          { label: "Success Rate", value: `${stats.successRate}%` },
          { label: "Session Time", value: stats.activeTime },
        ].map((stat, idx) => (
          <div key={idx} className="text-right border-l border-zinc-900 pl-5 first:border-0 first:pl-0">
            <div className="text-[8px] text-zinc-500 uppercase font-mono tracking-wider font-bold">
              {stat.label}
            </div>
            <div className="text-xs font-bold text-zinc-300 font-mono tracking-tight">
              {stat.value}
            </div>
          </div>
        ))}
      </div>
    </header>
  );
}
