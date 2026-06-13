"use client";

import React from "react";
import { Key, Copy, Check, PlusCircle } from "lucide-react";

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

interface KeysTabProps {
  apiKeys: ApiKey[];
  newKeyName: string;
  setNewKeyName: (name: string) => void;
  newKeyExpiration: string;
  setNewKeyExpiration: (expiration: string) => void;
  handleCreateKey: (e: React.FormEvent) => Promise<void>;
  handleToggleKey: (id: string, active: boolean) => Promise<void>;
  copiedKey: string | null;
  copyText: (text: string) => void;
}

export default function KeysTab({
  apiKeys,
  newKeyName,
  setNewKeyName,
  newKeyExpiration,
  setNewKeyExpiration,
  handleCreateKey,
  handleToggleKey,
  copiedKey,
  copyText
}: KeysTabProps) {
  return (
    <div className="flex-grow overflow-y-auto px-6 py-6 space-y-6 custom-scrollbar font-sans bg-[#07080a]">
      {/* Top Section: Key Generator */}
      <div className="max-w-2xl mx-auto">
        <div className="bg-[#0b0c0f] border border-zinc-800 rounded p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-zinc-900 pb-3">
            <Key size={14} className="text-cyan-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">Key Issuance Generator</h3>
          </div>

          <form onSubmit={handleCreateKey} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[9px] font-mono tracking-wider text-zinc-500 uppercase">
                  Key Identifier / Label
                </label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g. CLI Client, Localhost-test..."
                  className="w-full bg-[#0e0f13] border border-zinc-850 focus:border-zinc-700 rounded px-3 py-2 text-xs font-mono text-zinc-300 outline-none transition"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-mono tracking-wider text-zinc-500 uppercase">Validity Period</label>
                <div className="relative">
                  <select
                    value={newKeyExpiration}
                    onChange={(e) => setNewKeyExpiration(e.target.value)}
                    className="w-full bg-[#0e0f13] border border-zinc-850 focus:border-zinc-700 rounded px-3 py-2 text-xs font-mono text-zinc-300 outline-none transition cursor-pointer appearance-none"
                  >
                    <option value="never" className="bg-[#090a0f] font-mono">
                      Never Expire
                    </option>
                    <option value="1h" className="bg-[#090a0f] font-mono">
                      1 Hour
                    </option>
                    <option value="24h" className="bg-[#090a0f] font-mono">
                      24 Hours
                    </option>
                    <option value="7d" className="bg-[#090a0f] font-mono">
                      7 Days
                    </option>
                    <option value="30d" className="bg-[#090a0f] font-mono">
                      30 Days
                    </option>
                    <option value="90d" className="bg-[#090a0f] font-mono">
                      90 Days
                    </option>
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 hover:border-cyan-500/40 rounded py-2.5 text-xs font-mono transition flex items-center justify-center gap-1.5"
            >
              <PlusCircle size={13} />
              <span>Issue New API Token</span>
            </button>
          </form>
        </div>
      </div>

      {/* Active API Keys Table Block */}
      <div className="bg-[#0b0c0f] border border-zinc-800 rounded p-5 space-y-4">
        <div className="flex items-center gap-2 border-b border-zinc-900 pb-3">
          <Key size={14} className="text-cyan-400" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
            Active Authentication Keys
          </h3>
        </div>

        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse font-mono">
            <thead>
              <tr className="border-b border-zinc-900 text-zinc-500 text-[9px] uppercase tracking-wider">
                <th className="pb-2.5 pr-4">Token Label</th>
                <th className="pb-2.5 px-4">Bearer Key Hash</th>
                <th className="pb-2.5 px-4">Created At</th>
                <th className="pb-2.5 px-4">Expires At</th>
                <th className="pb-2.5 px-4">Status</th>
                <th className="pb-2.5 pl-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900 text-xs">
              {apiKeys.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-500 font-mono text-[10px]">
                    No keys have been issued yet. Configure keys above.
                  </td>
                </tr>
              ) : (
                apiKeys.map((k) => {
                  const isExpired = k.expires_at && new Date(k.expires_at) < new Date();
                  return (
                    <tr key={k.id} className="hover:bg-[#0e0f13]/55 transition-colors">
                      <td className="py-3 pr-4 font-bold text-zinc-200 text-[11px]">{k.name}</td>
                      <td className="py-3 px-4 text-cyan-400 text-[10px] flex items-center gap-2">
                        <span className="select-all">{k.key.substring(0, 16)}...</span>
                        <button
                          onClick={() => copyText(k.key)}
                          className="text-zinc-500 hover:text-cyan-400 transition"
                        >
                          {copiedKey === k.key ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-zinc-400 text-[11px]">
                        {new Date(k.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-zinc-400 text-[11px]">
                        {k.expires_at ? new Date(k.expires_at).toLocaleString() : "Never"}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                            isExpired
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : k.active
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          }`}
                        >
                          <span
                            className={`h-1 w-1 rounded-full ${isExpired ? "bg-amber-400" : k.active ? "bg-emerald-400" : "bg-rose-400"}`}
                          />
                          {isExpired ? "Expired" : k.active ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="py-3 pl-4 text-right">
                        <button
                          onClick={() => handleToggleKey(k.id, k.active)}
                          disabled={!!isExpired}
                          className={`text-[9px] font-bold tracking-wider uppercase px-2.5 py-1 rounded transition border ${
                            isExpired
                              ? "border-zinc-800 text-zinc-600 cursor-not-allowed"
                              : k.active
                                ? "border-rose-500/20 text-rose-400 hover:bg-rose-500/10"
                                : "border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10"
                          }`}
                        >
                          {k.active ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
