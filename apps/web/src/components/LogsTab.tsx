"use client";

import React from "react";
import { Terminal, Activity, Clock } from "lucide-react";
import { translations, Language } from "../utils/i18n";

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

interface LogsTabProps {
  recentLogs: UsageLog[];
  lang: Language;
}

export default function LogsTab({ recentLogs, lang }: LogsTabProps) {
  const t = translations[lang];

  return (
    <div className="flex-grow overflow-hidden px-6 py-6 flex flex-col bg-[#07080a] font-sans h-full">
      <div className="bg-[#0b0c0f] border border-zinc-800 rounded p-5 flex flex-col h-full overflow-hidden">
        {/* Terminal Header */}
        <div className="flex items-center justify-between border-b border-zinc-900 pb-3 shrink-0 select-none">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-cyan-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">{t.logsTitle}</h3>
          </div>
          <span className="text-[9px] text-zinc-500 font-mono">STDOUT / GATEWAY_LOGS</span>
        </div>

        {/* Console Logs Wrapper */}
        <div className="flex-grow overflow-y-auto space-y-3 custom-scrollbar pr-1 mt-4">
          {recentLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-zinc-500 py-16 font-mono">
              <Activity size={20} className="mb-2 animate-pulse text-zinc-600" />
              <p className="text-[10px] uppercase tracking-wider">{t.noLogsYet}</p>
            </div>
          ) : (
            <div className="space-y-2.5 max-w-4xl mx-auto w-full font-mono text-[10px]">
              {recentLogs.map((l) => {
                const isSuccess = l.status_code >= 200 && l.status_code < 300;
                return (
                  <div
                    key={l.id}
                    className="p-3 bg-[#0d0e12] border border-zinc-850 rounded hover:border-zinc-700 transition duration-150 space-y-2"
                  >
                    {/* Log Title Line */}
                    <div className="flex items-center justify-between select-none">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold ${
                            isSuccess
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          }`}
                        >
                          HTTP {l.status_code}
                        </span>
                        <span className="font-bold text-cyan-400">{l.model}</span>
                        {l.api_keys?.name && (
                          <span className="text-[8px] text-zinc-500 px-1 py-0.5 border border-zinc-800 rounded">
                            {l.api_keys.name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-zinc-500">
                        <Clock size={11} />
                        <span>{l.duration_ms}ms</span>
                      </div>
                    </div>

                    {/* Log Metrics Details */}
                    <div className="flex items-center gap-4 text-zinc-400 text-[9px]">
                      <div>
                        Prompt: <span className="text-zinc-200">{l.prompt_tokens}</span>
                      </div>
                      <div>
                        Completion: <span className="text-zinc-200">{l.completion_tokens}</span>
                      </div>
                      <div>
                        Total: <span className="text-zinc-200">{l.total_tokens}</span>
                      </div>
                      <div className="ml-auto text-zinc-600" suppressHydrationWarning>
                        {new Date(l.created_at).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
