"use client";

import React, { useMemo, useState } from "react";
import { Activity, Clock, RefreshCw, Search, Trash2 } from "lucide-react";
import { translations, Language } from "../utils/i18n";

export interface UsageLogItem {
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

export interface StatsSummary {
  totalRequests: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  avgDurationMs: number;
  successRate: number;
}

interface LogsTabProps {
  stats: StatsSummary;
  recentLogs: UsageLogItem[];
  onRefresh: () => Promise<void>;
  onClear: () => Promise<void>;
  lang: Language;
}

export default function LogsTab({ stats, recentLogs, onRefresh, onClear, lang }: LogsTabProps) {
  const t = translations[lang];
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "error">("all");
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recentLogs.filter((entry) => {
      const isOk = entry.status_code >= 200 && entry.status_code < 300;
      if (statusFilter === "ok" && !isOk) return false;
      if (statusFilter === "error" && isOk) return false;
      if (!q) return true;
      return (
        entry.model.toLowerCase().includes(q) ||
        (entry.api_keys?.name || "").toLowerCase().includes(q) ||
        (entry.projects?.name || "").toLowerCase().includes(q)
      );
    });
  }, [recentLogs, search, statusFilter]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      await onClear();
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 pb-20 md:pb-8 bg-[#0a0b0e] custom-scrollbar">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header & Refresh */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[#eceef4]">{t.logsTitle}</h3>
            <p className="text-xs text-[#8e95a8] mt-0.5">{t.logsSubtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClear}
              disabled={clearing || stats.totalRequests === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111319] hover:bg-rose-500/15 border border-[#222633] hover:border-rose-500/30 text-xs font-medium text-[#8e95a8] hover:text-rose-300 transition-colors disabled:opacity-40"
            >
              <Trash2 size={13} />
              <span>{t.btnClearLogs}</span>
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111319] hover:bg-[#171a22] border border-[#222633] text-xs font-medium text-[#eceef4] transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin text-[#4f8cff]" : ""} />
              <span>{t.btnRefreshLogs}</span>
            </button>
          </div>
        </div>

        {/* 4 Summary Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl bg-[#111319] border border-[#222633] p-4">
            <div className="text-xs text-[#8e95a8]">{t.metricTotalRequests}</div>
            <div className="text-xl font-semibold text-[#eceef4] font-mono tabular-nums mt-1">
              {stats.totalRequests.toLocaleString()}
            </div>
          </div>

          <div className="rounded-xl bg-[#111319] border border-[#222633] p-4">
            <div className="text-xs text-[#8e95a8]">{t.metricTotalTokens}</div>
            <div className="text-xl font-semibold text-[#eceef4] font-mono tabular-nums mt-1">
              {stats.totalTokens.toLocaleString()}
            </div>
            <div className="text-[11px] text-[#8e95a8] font-mono tabular-nums mt-1">
              {t.metricPromptLabel}: {stats.totalPromptTokens.toLocaleString()} · {t.metricCompletionLabel}:{" "}
              {stats.totalCompletionTokens.toLocaleString()}
            </div>
          </div>

          <div className="rounded-xl bg-[#111319] border border-[#222633] p-4">
            <div className="text-xs text-[#8e95a8]">{t.metricSuccessRate}</div>
            <div className="text-xl font-semibold text-emerald-400 font-mono tabular-nums mt-1">
              {stats.successRate}%
            </div>
          </div>

          <div className="rounded-xl bg-[#111319] border border-[#222633] p-4">
            <div className="text-xs text-[#8e95a8]">{t.metricAvgLatency}</div>
            <div className="text-xl font-semibold text-[#eceef4] font-mono tabular-nums mt-1">
              {stats.avgDurationMs} ms
            </div>
          </div>
        </div>

        {/* Filters & Table */}
        <div className="rounded-xl bg-[#111319] border border-[#222633] overflow-hidden">
          <div className="p-4 border-b border-[#222633] flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8e95a8]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.searchLogsPlaceholder}
                className="w-full bg-[#0d0f14] border border-[#222633] focus:border-[#4f8cff] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#eceef4] placeholder-[#8e95a8]/70 outline-none"
              />
            </div>

            <div className="inline-flex rounded-lg bg-[#0d0f14] border border-[#222633] p-0.5 text-xs">
              {(
                [
                  { id: "all", label: t.filterAll },
                  { id: "ok", label: t.filterOk },
                  { id: "error", label: t.filterErrors }
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStatusFilter(f.id)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    statusFilter === f.id ? "bg-[#4f8cff]/20 text-[#eceef4]" : "text-[#8e95a8] hover:text-[#eceef4]"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            {recentLogs.length === 0 ? (
              <div className="py-16 text-center text-[#8e95a8] text-xs space-y-2">
                <Activity size={20} className="mx-auto text-[#8e95a8]/60" />
                <p>{t.noLogsYet}</p>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="py-12 text-center text-[#8e95a8] text-xs">{t.noMatchingLogs}</div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#222633] text-[#8e95a8] bg-[#0d0f14]/60">
                    <th className="py-2.5 px-4 font-medium">{t.thTime}</th>
                    <th className="py-2.5 px-4 font-medium">{t.thStatus}</th>
                    <th className="py-2.5 px-4 font-medium">{t.thModel}</th>
                    <th className="py-2.5 px-4 font-medium">{t.thSource}</th>
                    <th className="py-2.5 px-4 font-medium">{t.thTokens}</th>
                    <th className="py-2.5 px-4 font-medium text-right">{t.thLatency}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222633]/60 font-mono">
                  {filteredLogs.map((l) => {
                    const isSuccess = l.status_code >= 200 && l.status_code < 300;
                    return (
                      <tr key={l.id} className="hover:bg-[#171a22]/50 transition-colors">
                        <td className="py-2.5 px-4 text-[#8e95a8] whitespace-nowrap" suppressHydrationWarning>
                          {new Date(l.created_at).toLocaleTimeString()}
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
                              isSuccess ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
                            }`}
                          >
                            {l.status_code}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-[#eceef4] font-medium">{l.model}</td>
                        <td className="py-2.5 px-4 text-[#8e95a8]">
                          {l.api_keys?.name || "Default"}
                          {l.projects?.name ? ` · ${l.projects.name}` : ""}
                        </td>
                        <td className="py-2.5 px-4 text-[#c5cbe0] tabular-nums">
                          {l.prompt_tokens} / {l.completion_tokens} ({l.total_tokens})
                        </td>
                        <td className="py-2.5 px-4 text-right text-[#8e95a8] tabular-nums whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <Clock size={11} />
                            {l.duration_ms} ms
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
