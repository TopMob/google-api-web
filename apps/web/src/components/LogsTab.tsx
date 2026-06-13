"use client";

import React from "react";
import { Terminal, Activity, Clock } from "lucide-react";

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
}

export default function LogsTab({ recentLogs }: LogsTabProps) {
  return (
    <div className="flex-grow overflow-hidden px-6 py-6 flex flex-col bg-[#07080a] font-sans h-full">
      <div className="bg-[#0b0c0f] border border-zinc-800 rounded p-5 flex flex-col h-full overflow-hidden">
        {/* Terminal Header */}
        <div className="flex items-center justify-between border-b border-zinc-900 pb-3 shrink-0 select-none">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-cyan-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
              Rolling Analytical Stream
            </h3>
          </div>
          <span className="text-[9px] text-zinc-550 font-mono">STDOUT / GATEWAY_LOGS</span>
        </div>

        {/* Console Logs Wrapper */}
        <div className="flex-grow overflow-y-auto space-y-3 custom-scrollbar pr-1 mt-4">
          {recentLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-zinc-500 py-16 font-mono">
              <Activity size={20} className="mb-2 animate-pulse text-zinc-600" />
              <p className="text-[10px] uppercase tracking-wider">
                Listening on local gateway... No requests captured yet.
              </p>
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
                          {l.status_code}
                        </span>
                        <span className="font-bold text-zinc-300">{l.model}</span>
                      </div>
                      <span className="text-[9px] text-zinc-550 flex items-center gap-1">
                        <Clock size={10} />
                        {new Date(l.created_at).toLocaleTimeString()}
                      </span>
                    </div>

                    {/* Log Specs row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-[9px] text-zinc-400 border-t border-zinc-900 select-text">
                      <div>
                        <span className="text-zinc-600 uppercase block text-[8px] select-none font-bold">Project</span>
                        <span className="text-zinc-350 font-semibold">{l.projects?.name || "N/A"}</span>
                      </div>
                      <div>
                        <span className="text-zinc-600 uppercase block text-[8px] select-none font-bold">
                          Auth Token
                        </span>
                        <span className="text-zinc-350 font-semibold">{l.api_keys?.name || "N/A"}</span>
                      </div>
                      <div>
                        <span className="text-zinc-600 uppercase block text-[8px] select-none font-bold">
                          Data Size
                        </span>
                        <span className="text-zinc-350 font-semibold text-cyan-400">{l.total_tokens} tokens</span>
                      </div>
                      <div>
                        <span className="text-zinc-600 uppercase block text-[8px] select-none font-bold">Latency</span>
                        <span className="text-zinc-350 font-semibold text-amber-400">{l.duration_ms}ms</span>
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
