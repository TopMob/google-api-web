"use client";

import React from "react";
import {
  HelpCircle,
  Lock,
  BookOpen,
  Key,
  FileText,
  Settings,
  Activity,
  Shield,
  ExternalLink,
  Copy,
  Check,
  Code,
  Info,
  RefreshCw
} from "lucide-react";

interface FaqTabProps {
  cookieTestInput: string;
  setCookieTestInput: (input: string) => void;
  testResult: { success: boolean; message: string } | null;
  isTestingCookie: boolean;
  handleTestCookie: () => Promise<void>;
  activeProvider: "opencode" | "vscode" | "codex" | "codex_cli" | "openclaw" | "cursor" | "jetbrains" | "zed";
  setActiveProvider: (
    prov: "opencode" | "vscode" | "codex" | "codex_cli" | "openclaw" | "cursor" | "jetbrains" | "zed"
  ) => void;
  activePlatform: "windows" | "macos" | "linux";
  setActivePlatform: (plat: "windows" | "macos" | "linux") => void;
  copiedId: string | null;
  copyGuideText: (text: string, id: string) => void;
  selectedModel: string;
  activeKey: string;
  gatewayUrl: string;
  models: string[];
}

export default function FaqTab({
  cookieTestInput,
  setCookieTestInput,
  testResult,
  isTestingCookie,
  handleTestCookie,
  activeProvider,
  setActiveProvider,
  activePlatform,
  setActivePlatform,
  copiedId,
  copyGuideText,
  selectedModel,
  activeKey,
  gatewayUrl,
  models
}: FaqTabProps) {
  // Compute standard API base URL
  const apiBaseUrl = gatewayUrl.endsWith("/v1") ? gatewayUrl : `${gatewayUrl}/v1`;

  // Render models object for OpenCode configurations
  const getOpenCodeConfig = () => {
    const modelsObj = models.reduce(
      (acc, m) => {
        const displayName = m
          .split("-")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
        acc[m] = { name: `${displayName} (Web2API)` };
        return acc;
      },
      {} as Record<string, { name: string }>
    );

    return JSON.stringify(
      {
        provider: {
          "gemini-web2api": {
            npm: "@ai-sdk/openai-compatible",
            name: "Gemini Web2API",
            options: {
              baseURL: apiBaseUrl,
              apiKey: activeKey
            },
            models: modelsObj
          }
        }
      },
      null,
      2
    );
  };

  // Render continue config for VS Code
  const getContinueConfig = () => {
    return JSON.stringify(
      {
        models: [
          {
            title: "Gemini 3.5 Flash Thinking (Web2API)",
            provider: "openai",
            model: "gemini-3.5-flash-thinking",
            apiBase: apiBaseUrl,
            apiKey: activeKey
          },
          {
            title: "Gemini 3.5 Flash (Web2API)",
            provider: "openai",
            model: "gemini-3.5-flash",
            apiBase: apiBaseUrl,
            apiKey: activeKey
          }
        ]
      },
      null,
      2
    );
  };

  // Render Zed config
  const getZedConfig = () => {
    return JSON.stringify(
      {
        language_models: {
          openai: {
            api_url: apiBaseUrl,
            api_key: activeKey,
            available_models: models
          }
        }
      },
      null,
      2
    );
  };

  // Render OpenClaw config
  const getOpenClawConfig = () => {
    const modelsList = models.map((m) => `"${m}"`).join(", ");
    return `[provider.gemini_web2api]
api_type = "openai"
api_base = "${apiBaseUrl}"
api_key = "${activeKey}"
models = [${modelsList}]`;
  };

  return (
    <div className="flex-grow overflow-y-auto px-6 py-6 space-y-6 custom-scrollbar font-sans bg-[#07080a]">
      {/* Documentation Banner */}
      <div className="relative overflow-hidden bg-[#0b0c0f] border border-zinc-800 rounded p-5 select-none">
        <div className="flex items-start gap-4">
          <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded text-cyan-400 shrink-0">
            <HelpCircle size={18} />
          </div>
          <div className="space-y-1">
            <h2 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
              Gateway Configuration & Integration Guide
            </h2>
            <p className="text-[11px] text-zinc-400 leading-relaxed max-w-2xl font-mono">
              Learn how to connect terminal coding assistants, web UIs, and IDE extensions to your running Gemini
              Web2API gateway. You can use your active API key and base URL directly inside your configurations.
            </p>
          </div>
        </div>
      </div>

      {/* Security Banner */}
      <div className="flex items-start gap-3 p-4 bg-[#0e0a05] border border-amber-500/10 rounded font-mono select-none">
        <Lock size={14} className="text-amber-500 shrink-0 mt-0.5" />
        <div className="text-[10px] text-zinc-400 leading-relaxed">
          <strong className="text-amber-400 uppercase tracking-wider">[Connection configuration]</strong> Currently
          active API key:{" "}
          <code className="text-cyan-400 font-bold bg-[#0e0f13] border border-zinc-800 px-1.5 py-0.5 rounded select-all">
            {activeKey}
          </code>
          , Endpoint address:{" "}
          <code className="text-cyan-400 font-bold bg-[#0e0f13] border border-zinc-800 px-1.5 py-0.5 rounded select-all">
            {apiBaseUrl}
          </code>
          .
        </div>
      </div>

      {/* Guide Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Side: Table of Contents */}
        <div className="lg:col-span-1 space-y-2 select-none">
          <div className="text-[9px] font-mono tracking-widest text-zinc-500 uppercase px-2">Index</div>
          <nav className="space-y-0.5">
            {[
              { id: "step-connect-opencode", label: "1. Connecting OpenCode" },
              { id: "step-ide-configs", label: "2. IDE & Editor Setup" },
              { id: "step-available-models", label: "3. Supported Models List" },
              { id: "step-cookie-auth", label: "4. Cookie Auth Setup (Pro)" },
              { id: "step-diagnostic", label: "5. Cookie Validator" },
              { id: "step-diagnostics", label: "6. Diagnostics & Errors" }
            ].map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="block px-2.5 py-1.5 text-[11px] text-zinc-450 hover:text-cyan-400 font-mono rounded hover:bg-zinc-900/30 transition"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>

        {/* Right Side: Step Contents */}
        <div className="lg:col-span-3 space-y-6">
          {/* Step 1: Connecting OpenCode */}
          <section
            id="step-connect-opencode"
            className="bg-[#0b0c0f] border border-zinc-800 rounded p-5 space-y-4 scroll-mt-6"
          >
            <div className="border-b border-zinc-900 pb-3 flex items-center gap-2 select-none">
              <Code size={14} className="text-cyan-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                1. How to Connect OpenCode (npx opencode-ai)
              </h3>
            </div>

            <div className="space-y-3.5 text-[11px] text-zinc-300 font-mono">
              <p className="leading-relaxed text-zinc-400">
                OpenCode is a terminal-based AI coding assistant. You can link it to your local gateway in two ways:
              </p>

              <div className="space-y-2">
                <div className="font-bold text-zinc-200 uppercase text-[10px] tracking-wide">
                  Method A: Connect Command (TUI / CLI)
                </div>
                <p className="text-zinc-400">1. Launch OpenCode connection guide by typing the connect command:</p>
                <div className="relative bg-[#0e0f13] border border-zinc-850 rounded p-3 text-[10px] break-all select-all flex justify-between items-center gap-4">
                  <span className="text-zinc-300">npx opencode-ai "/connect"</span>
                  <button
                    type="button"
                    onClick={() => copyGuideText('npx opencode-ai "/connect"', "opencode-cmd")}
                    className="text-zinc-500 hover:text-cyan-400 transition shrink-0 p-1 bg-zinc-900 border border-zinc-850 rounded"
                    title="Copy command"
                  >
                    {copiedId === "opencode-cmd" ? (
                      <Check size={12} className="text-emerald-500" />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </div>
                <p className="text-zinc-400 leading-relaxed pl-1.5 border-l border-zinc-800">
                  2. Scroll down in the TUI select list to{" "}
                  <strong className="text-zinc-200">Other / OpenAI-compatible</strong>.<br />
                  3. Enter Provider ID:{" "}
                  <code className="text-cyan-400 bg-zinc-900 px-1 py-0.5 rounded border border-zinc-850">
                    gemini-web2api
                  </code>
                  .<br />
                  4. Enter Base URL:{" "}
                  <code className="text-cyan-400 bg-zinc-900 px-1 py-0.5 rounded border border-zinc-850">
                    {apiBaseUrl}
                  </code>
                  .<br />
                  5. Enter API Key:{" "}
                  <code className="text-cyan-400 bg-zinc-900 px-1 py-0.5 rounded border border-zinc-850">
                    {activeKey}
                  </code>
                  .
                </p>
              </div>

              <div className="space-y-2 pt-2">
                <div className="font-bold text-zinc-200 uppercase text-[10px] tracking-wide">
                  Method B: Configuration File (opencode.json)
                </div>
                <p className="text-zinc-400">
                  Create or edit your global configuration file:{" "}
                  <code className="text-cyan-400 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-850">
                    {activePlatform === "windows"
                      ? "%USERPROFILE%\\.config\\opencode\\opencode.json"
                      : "~/.config/opencode/opencode.json"}
                  </code>
                </p>
                <div className="relative bg-[#0e0f13] border border-zinc-850 rounded p-4 text-[9px] block">
                  <pre className="overflow-x-auto select-all leading-normal text-zinc-300">{getOpenCodeConfig()}</pre>
                  <button
                    type="button"
                    onClick={() => copyGuideText(getOpenCodeConfig(), "opencode-json-config")}
                    className="absolute top-4 right-4 text-zinc-550 hover:text-cyan-400 transition p-1 bg-zinc-900 border border-zinc-850 rounded"
                    title="Copy configuration template"
                  >
                    {copiedId === "opencode-json-config" ? (
                      <Check size={12} className="text-emerald-500" />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <div className="font-bold text-zinc-200 uppercase text-[10px] tracking-wide">
                  Method C: Shell Environment Variables
                </div>
                <p className="text-zinc-400">
                  Alternatively, tell the OpenCode client to use your API Key by exporting the shell variable:
                </p>
                <div className="relative bg-[#0e0f13] border border-zinc-850 rounded p-3 text-[10px] break-all select-all flex justify-between items-center gap-4">
                  <span className="text-zinc-300">
                    {activePlatform === "windows"
                      ? `$env:OPENAI_API_KEY="${activeKey}"`
                      : `export OPENAI_API_KEY="${activeKey}"`}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      copyGuideText(
                        activePlatform === "windows"
                          ? `$env:OPENAI_API_KEY="${activeKey}"`
                          : `export OPENAI_API_KEY="${activeKey}"`,
                        "opencode-env"
                      )
                    }
                    className="text-zinc-500 hover:text-cyan-400 transition shrink-0 p-1 bg-zinc-900 border border-zinc-850 rounded"
                    title="Copy export line"
                  >
                    {copiedId === "opencode-env" ? (
                      <Check size={12} className="text-emerald-500" />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Step 2: IDE Configurations */}
          <section
            id="step-ide-configs"
            className="bg-[#0b0c0f] border border-zinc-800 rounded p-5 space-y-4 scroll-mt-6"
          >
            <div className="border-b border-zinc-900 pb-3 flex items-center gap-2 select-none">
              <FileText size={14} className="text-cyan-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                2. IDE & Editor Custom Endpoint Setup
              </h3>
            </div>

            <div className="space-y-4 text-[11px] text-zinc-300 font-mono">
              <p className="leading-relaxed text-zinc-400">
                You can configure custom OpenAI-compatible settings in standard coding tools. Choose your app and OS
                below:
              </p>

              {/* Provider Selection */}
              <div className="space-y-1.5 select-none">
                <div className="text-[9px] uppercase font-bold tracking-wider text-zinc-500">Select Tool</div>
                <div className="flex flex-wrap gap-1 p-1 bg-[#0e0f13] border border-zinc-850 rounded">
                  {[
                    { id: "vscode", name: "VS Code (Continue)" },
                    { id: "cursor", name: "Cursor" },
                    { id: "zed", name: "Zed" },
                    { id: "jetbrains", name: "JetBrains" },
                    { id: "openclaw", name: "OpenClaw / Libre" },
                    { id: "codex_cli", name: "Codex / Shell" }
                  ].map((prov) => (
                    <button
                      key={prov.id}
                      type="button"
                      onClick={() => setActiveProvider(prov.id as any)}
                      className={`px-2.5 py-1 rounded text-[9px] font-mono tracking-wide transition ${
                        activeProvider === prov.id
                          ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                          : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/30"
                      }`}
                    >
                      {prov.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Platform Selectors */}
              <div className="space-y-1.5 select-none">
                <div className="text-[9px] uppercase font-bold tracking-wider text-zinc-500">Select OS</div>
                <div className="flex gap-1 p-1 bg-[#0e0f13] border border-zinc-850 rounded max-w-xs">
                  {[
                    { id: "windows", name: "Windows" },
                    { id: "macos", name: "macOS" },
                    { id: "linux", name: "Linux" }
                  ].map((plat) => (
                    <button
                      key={plat.id}
                      type="button"
                      onClick={() => setActivePlatform(plat.id as any)}
                      className={`flex-1 px-2.5 py-1 rounded text-[9px] font-mono tracking-wide transition ${
                        activePlatform === plat.id
                          ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                          : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/30"
                      }`}
                    >
                      {plat.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dynamic instructions based on activeProvider */}
              {activeProvider === "vscode" && (
                <div className="space-y-3 pt-2">
                  <h4 className="font-bold text-zinc-200 text-xs">VS Code Continue Extension Setup</h4>
                  <p className="text-zinc-400 leading-relaxed">
                    Open your Continue configuration file at:{" "}
                    <code className="text-cyan-400 bg-zinc-900 border border-zinc-850 px-1 py-0.5 rounded">
                      {activePlatform === "windows"
                        ? "%USERPROFILE%\\.continue\\config.json"
                        : "~/.continue/config.json"}
                    </code>
                  </p>
                  <p className="text-zinc-400">
                    Add the following objects inside the{" "}
                    <code className="text-zinc-350 bg-zinc-900 px-1 rounded">"models"</code> array:
                  </p>
                  <div className="relative bg-[#0e0f13] border border-zinc-850 rounded p-4 text-[9px] block">
                    <pre className="overflow-x-auto select-all leading-normal text-zinc-300">{getContinueConfig()}</pre>
                    <button
                      type="button"
                      onClick={() => copyGuideText(getContinueConfig(), "vscode-continue-config")}
                      className="absolute top-4 right-4 text-zinc-550 hover:text-cyan-400 transition p-1 bg-zinc-900 border border-zinc-855 rounded"
                      title="Copy VS Code configuration"
                    >
                      {copiedId === "vscode-continue-config" ? (
                        <Check size={12} className="text-emerald-500" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {activeProvider === "cursor" && (
                <div className="space-y-3 pt-2">
                  <h4 className="font-bold text-zinc-200 text-xs">Cursor OpenAI-Compatible API Configuration</h4>
                  <p className="text-zinc-400 leading-relaxed">
                    1. Open Cursor and navigate to{" "}
                    <strong className="text-zinc-200">Settings ➔ Models ➔ OpenAI-Compatible</strong>.<br />
                    2. Enable the section and enter the credentials:
                    <br />
                    &nbsp;&nbsp;&bull; <strong className="text-zinc-300">Base URL:</strong>{" "}
                    <code className="text-cyan-400">{apiBaseUrl}</code>
                    <br />
                    &nbsp;&nbsp;&bull; <strong className="text-zinc-300">API Key:</strong>{" "}
                    <code className="text-cyan-400">{activeKey}</code>
                    <br />
                    3. Under the model listing, add custom models:{" "}
                    <code className="text-zinc-300">gemini-3.5-flash-thinking</code> and{" "}
                    <code className="text-zinc-300">gemini-3.5-flash</code>.<br />
                    4. Disable standard OpenAI models to route requests exclusively to the Web2API gateway.
                  </p>
                </div>
              )}

              {activeProvider === "zed" && (
                <div className="space-y-3 pt-2">
                  <h4 className="font-bold text-zinc-200 text-xs">Zed Editor OpenAI Provider Config</h4>
                  <p className="text-zinc-400 leading-relaxed">
                    Open your settings json file:{" "}
                    <code className="text-cyan-400 bg-zinc-900 border border-zinc-850 px-1 py-0.5 rounded">
                      {activePlatform === "windows"
                        ? "%USERPROFILE%\\.config\\zed\\settings.json"
                        : "~/.config/zed/settings.json"}
                    </code>
                  </p>
                  <p className="text-zinc-400">
                    Add or modify the <code className="text-zinc-350 bg-zinc-900 px-1 rounded">"language_models"</code>{" "}
                    field:
                  </p>
                  <div className="relative bg-[#0e0f13] border border-zinc-850 rounded p-4 text-[9px] block">
                    <pre className="overflow-x-auto select-all leading-normal text-zinc-300">{getZedConfig()}</pre>
                    <button
                      type="button"
                      onClick={() => copyGuideText(getZedConfig(), "zed-config-copy")}
                      className="absolute top-4 right-4 text-zinc-550 hover:text-cyan-400 transition p-1 bg-zinc-900 border border-zinc-855 rounded"
                      title="Copy Zed configuration"
                    >
                      {copiedId === "zed-config-copy" ? (
                        <Check size={12} className="text-emerald-500" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {activeProvider === "jetbrains" && (
                <div className="space-y-3 pt-2">
                  <h4 className="font-bold text-zinc-200 text-xs">JetBrains AI Assistant / LLM Plugins</h4>
                  <p className="text-zinc-400 leading-relaxed font-mono">
                    1. Open JetBrains Settings / Preferences (Ctrl+Alt+S).
                    <br />
                    2. Go to <strong className="text-zinc-200">Tools ➔ AI assistant</strong> or install third-party
                    plugins like Bito or Continue.
                    <br />
                    3. Choose <strong className="text-zinc-200">Custom OpenAI Endpoint</strong>.<br />
                    4. Set the parameters:
                    <br />
                    &nbsp;&nbsp;&bull; <strong className="text-zinc-300">API URL:</strong>{" "}
                    <code className="text-cyan-400">{apiBaseUrl}</code>
                    <br />
                    &nbsp;&nbsp;&bull; <strong className="text-zinc-300">API Key:</strong>{" "}
                    <code className="text-cyan-400">{activeKey}</code>
                    <br />
                    5. Manually configure the active model name to:{" "}
                    <code className="text-cyan-400">gemini-3.5-flash-thinking</code>.
                  </p>
                </div>
              )}

              {activeProvider === "openclaw" && (
                <div className="space-y-3 pt-2">
                  <h4 className="font-bold text-zinc-200 text-xs">OpenClaw TOML Configuration</h4>
                  <p className="text-zinc-400 leading-relaxed">
                    Paste this into your provider settings inside `openclaw.toml`:
                  </p>
                  <div className="relative bg-[#0e0f13] border border-zinc-855 rounded p-4 text-[9px] block">
                    <pre className="overflow-x-auto select-all leading-normal text-zinc-300">{getOpenClawConfig()}</pre>
                    <button
                      type="button"
                      onClick={() => copyGuideText(getOpenClawConfig(), "openclaw-toml-copy")}
                      className="absolute top-4 right-4 text-zinc-550 hover:text-cyan-400 transition p-1 bg-zinc-900 border border-zinc-855 rounded"
                      title="Copy OpenClaw configuration"
                    >
                      {copiedId === "openclaw-toml-copy" ? (
                        <Check size={12} className="text-emerald-500" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {activeProvider === "codex_cli" && (
                <div className="space-y-3 pt-2 font-mono">
                  <h4 className="font-bold text-zinc-200 text-xs">Custom Shell Script / cURL Testing</h4>
                  <p className="text-zinc-400">Quickly verify connection using standard command-line tools:</p>
                  <div className="relative bg-[#0e0f13] border border-zinc-850 rounded p-4 text-[9px] block">
                    <pre className="overflow-x-auto select-all leading-normal text-zinc-300">
                      {`curl ${apiBaseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${activeKey}" \\
  -d '{
    "model": "gemini-3.5-flash",
    "messages": [{"role": "user", "content": "Explain quantum physics in one sentence"}]
  }'`}
                    </pre>
                    <button
                      type="button"
                      onClick={() =>
                        copyGuideText(
                          `curl ${apiBaseUrl}/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${activeKey}" \\\n  -d '{\n    "model": "gemini-3.5-flash",\n    "messages": [{"role": "user", "content": "Explain quantum physics in one sentence"}]\n  }'`,
                          "curl-test"
                        )
                      }
                      className="absolute top-4 right-4 text-zinc-550 hover:text-cyan-400 transition p-1 bg-zinc-900 border border-zinc-850 rounded"
                      title="Copy cURL test query"
                    >
                      {copiedId === "curl-test" ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Step 3: Available Models List */}
          <section
            id="step-available-models"
            className="bg-[#0b0c0f] border border-zinc-800 rounded p-5 space-y-4 scroll-mt-6"
          >
            <div className="border-b border-zinc-900 pb-3 flex items-center gap-2 select-none">
              <BookOpen size={14} className="text-cyan-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                3. List of Supported Models
              </h3>
            </div>

            <div className="space-y-3.5 text-[11px] text-zinc-350 font-mono">
              <p className="text-zinc-400 leading-relaxed">
                The gateway exposes the following model identifiers which can be passed to the `/v1/chat/completions`
                API:
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-[10px] text-zinc-300">
                  <thead>
                    <tr className="border-b border-zinc-900 text-zinc-500 uppercase tracking-wider select-none text-[8px] font-bold">
                      <th className="pb-2">Model ID</th>
                      <th className="pb-2 px-4">Output Length</th>
                      <th className="pb-2">Primary Use-case</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900">
                    <tr className="hover:bg-[#0e0f13]/40 transition">
                      <td className="py-2.5 font-bold text-cyan-400 select-all">gemini-2.0-flash</td>
                      <td className="py-2.5 px-4 text-zinc-400 font-semibold">Fast (Default)</td>
                      <td className="py-2.5 text-zinc-400">Official fast multimodal model with next-gen speed</td>
                    </tr>
                    <tr className="hover:bg-[#0e0f13]/40 transition">
                      <td className="py-2.5 font-bold text-cyan-400 select-all">gemini-2.0-flash-thinking-exp</td>
                      <td className="py-2.5 px-4 text-zinc-400 font-semibold">~20k chars</td>
                      <td className="py-2.5 text-zinc-400">Advanced reasoning & extended thinking mode</td>
                    </tr>
                    <tr className="hover:bg-[#0e0f13]/40 transition">
                      <td className="py-2.5 font-bold text-cyan-400 select-all">gemini-2.0-pro-exp-02-05</td>
                      <td className="py-2.5 px-4 text-zinc-400 font-semibold">Flagship</td>
                      <td className="py-2.5 text-zinc-400">
                        Top-tier coding, complex reasoning & benchmark performance
                      </td>
                    </tr>
                    <tr className="hover:bg-[#0e0f13]/40 transition">
                      <td className="py-2.5 font-bold text-cyan-400 select-all">gemini-2.0-flash-lite</td>
                      <td className="py-2.5 px-4 text-zinc-400 font-semibold">Ultra-fast</td>
                      <td className="py-2.5 text-zinc-400">Lowest latency, high throughput</td>
                    </tr>
                    <tr className="hover:bg-[#0e0f13]/40 transition">
                      <td className="py-2.5 font-bold text-cyan-400 select-all">gemini-1.5-pro</td>
                      <td className="py-2.5 px-4 text-zinc-400 font-semibold">2M Context</td>
                      <td className="py-2.5 text-zinc-400">Deep context reasoning and document analysis</td>
                    </tr>
                    <tr className="hover:bg-[#0e0f13]/40 transition">
                      <td className="py-2.5 font-bold text-cyan-400 select-all">gemini-1.5-flash</td>
                      <td className="py-2.5 px-4 text-zinc-400 font-semibold">1M Context</td>
                      <td className="py-2.5 text-zinc-400">Proven lightweight multimodal generation</td>
                    </tr>
                    <tr className="hover:bg-[#0e0f13]/40 transition">
                      <td className="py-2.5 font-bold text-cyan-400 select-all">gemini-auto</td>
                      <td className="py-2.5 px-4 text-zinc-400 font-semibold">Auto</td>
                      <td className="py-2.5 text-zinc-400">Automatic routing based on prompt size and type</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="p-3 bg-[#0d0e12] border border-zinc-850 rounded">
                <span className="font-bold text-zinc-200 block text-[9px] mb-1 select-none">
                  [Deep Thinking Depth Control]
                </span>
                <p className="text-zinc-400 leading-relaxed text-[10px]">
                  You can append <code className="text-cyan-400 font-mono">@think=N</code> to any model name to specify
                  thinking depth (where 0 is deepest reasoning, 4 is normal):
                  <br />
                  &bull; <code className="text-zinc-350">gemini-2.0-flash-thinking-exp@think=0</code> (Deepest, default)
                  <br />
                  &bull; <code className="text-zinc-350">gemini-2.0-flash@think=0</code> (Enable thinking on flash)
                  <br />
                  &bull; <code className="text-zinc-350">gemini-2.0-flash-thinking-exp@think=4</code> (Fastest thinking)
                </p>
              </div>
            </div>
          </section>

          {/* Step 4: Cookie Auth Setup */}
          <section
            id="step-cookie-auth"
            className="bg-[#0b0c0f] border border-zinc-800 rounded p-5 space-y-4 scroll-mt-6"
          >
            <div className="border-b border-zinc-900 pb-3 flex items-center justify-between select-none">
              <div className="flex items-center gap-2">
                <Key size={14} className="text-cyan-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  4. Cookie Manager & Auto-Extraction
                </h3>
              </div>
              <span className="text-[10px] bg-cyan-950/40 text-cyan-400 border border-cyan-800/40 px-2 py-0.5 rounded font-mono">
                1-Click Fast Setup
              </span>
            </div>

            <div className="space-y-4 text-[11px] text-zinc-300 font-mono">
              <p className="leading-relaxed text-zinc-400">
                To route queries through Google Gemini's web backend and dynamically discover all active models, you
                need your Google session cookies. Use the quick 1-click bookmarklet or paste them directly:
              </p>

              {/* Reliable Cookie Extraction Guide */}
              <div className="p-3.5 bg-[#0e0f13] border border-cyan-500/20 rounded space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-cyan-300 uppercase tracking-wide flex items-center gap-1.5">
                    🍪 How to extract Gemini Cookies (DevTools or Extension)
                  </span>
                  <span className="text-[9px] bg-amber-950/40 text-amber-400 border border-amber-800/40 px-2 py-0.5 rounded font-mono">
                    HttpOnly Notice
                  </span>
                </div>
                <div className="text-[10px] text-zinc-400 leading-relaxed space-y-2">
                  <p className="text-zinc-300">
                    Google flags essential tokens (<code className="text-cyan-400 font-mono">__Secure-1PSID</code> and{" "}
                    <code className="text-cyan-400 font-mono">SID</code>) with the{" "}
                    <strong className="text-zinc-200">HttpOnly</strong> flag, meaning browser console scripts cannot
                    read them. Use one of two fast methods:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                    <div className="p-2.5 bg-[#07080a] border border-zinc-800 rounded space-y-1">
                      <span className="font-bold text-zinc-200 block text-[10px]">
                        Option A: Cookie-Editor Extension (1-Click)
                      </span>
                      <p className="text-[9px] text-zinc-400 leading-normal">
                        1. Install the free <strong className="text-zinc-300">Cookie-Editor</strong> extension
                        (Chrome/Firefox/Edge).
                        <br />
                        2. Open{" "}
                        <a
                          href="https://gemini.google.com"
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-400 underline"
                        >
                          gemini.google.com
                        </a>
                        .<br />
                        3. Open Cookie-Editor ➔ click <strong className="text-zinc-300">Export</strong> ➔ choose{" "}
                        <strong className="text-zinc-300">Header String</strong> (or JSON).
                        <br />
                        4. Paste the result into the box below!
                      </p>
                    </div>
                    <div className="p-2.5 bg-[#07080a] border border-zinc-800 rounded space-y-1">
                      <span className="font-bold text-zinc-200 block text-[10px]">
                        Option B: Chrome DevTools (No Extensions)
                      </span>
                      <p className="text-[9px] text-zinc-400 leading-normal">
                        1. Open{" "}
                        <a
                          href="https://gemini.google.com"
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-400 underline"
                        >
                          gemini.google.com
                        </a>{" "}
                        and press{" "}
                        <kbd className="px-1 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-[8px]">F12</kbd>.
                        <br />
                        2. Go to <strong className="text-zinc-300">Application</strong> (or Storage) ➔{" "}
                        <strong className="text-zinc-300">Cookies</strong> ➔{" "}
                        <strong className="text-zinc-300">gemini.google.com</strong>.<br />
                        3. Or go to <strong className="text-zinc-300">Network</strong>, send any message, click the
                        request ➔ copy the <strong className="text-zinc-300">Cookie</strong> header from Request
                        Headers.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Complete Cookie Checklist Table */}
              <div className="space-y-2 pt-2">
                <div className="font-bold text-zinc-200 uppercase text-[10px] tracking-wide flex items-center justify-between">
                  <span>List of Required & Recommended Cookies</span>
                </div>
                <div className="overflow-x-auto border border-zinc-850 rounded">
                  <table className="w-full text-left border-collapse text-[10px] text-zinc-300">
                    <thead>
                      <tr className="border-b border-zinc-850 bg-[#0e0f13] text-zinc-400 uppercase tracking-wider text-[9px] font-bold">
                        <th className="py-2 px-3">Cookie Name</th>
                        <th className="py-2 px-3">Priority</th>
                        <th className="py-2 px-3">Purpose</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-850/50">
                      <tr>
                        <td className="py-2 px-3 font-bold text-cyan-400 select-all">__Secure-1PSID</td>
                        <td className="py-2 px-3">
                          <span className="text-rose-400 font-bold bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-900/30">
                            Required
                          </span>
                        </td>
                        <td className="py-2 px-3 text-zinc-400">Primary Google session token</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-bold text-cyan-400 select-all">__Secure-1PSIDTS</td>
                        <td className="py-2 px-3">
                          <span className="text-rose-400 font-bold bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-900/30">
                            Required
                          </span>
                        </td>
                        <td className="py-2 px-3 text-zinc-400">Session timestamp token</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-bold text-cyan-400 select-all">__Secure-1PSIDCC</td>
                        <td className="py-2 px-3">
                          <span className="text-rose-400 font-bold bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-900/30">
                            Required
                          </span>
                        </td>
                        <td className="py-2 px-3 text-zinc-400">Cookie consent challenge verification</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-bold text-cyan-400 select-all">SAPISID</td>
                        <td className="py-2 px-3">
                          <span className="text-amber-400 font-bold bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-900/30">
                            Important
                          </span>
                        </td>
                        <td className="py-2 px-3 text-zinc-400">Generates SAPISIDHASH Authorization header</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-bold text-zinc-300 select-all">__Secure-3PSID & TS/CC</td>
                        <td className="py-2 px-3">
                          <span className="text-zinc-400 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                            Recommended
                          </span>
                        </td>
                        <td className="py-2 px-3 text-zinc-400">3rd-party session context fallback</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-bold text-zinc-300 select-all">SID, HSID, SSID, APISID</td>
                        <td className="py-2 px-3">
                          <span className="text-zinc-400 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                            Recommended
                          </span>
                        </td>
                        <td className="py-2 px-3 text-zinc-400">Standard Google authentication cookies</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          {/* Step 5: Save & Validate Cookie */}
          <section
            id="step-diagnostic"
            className="bg-[#0b0c0f] border border-zinc-800 rounded p-5 space-y-4 scroll-mt-6"
          >
            <div className="border-b border-zinc-900 pb-3 flex items-center gap-2 select-none">
              <Activity size={14} className="text-cyan-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                5. Save & Test Cookie In Local Gateway
              </h3>
            </div>

            <div className="space-y-4 text-[11px] text-zinc-300 font-mono">
              <p className="leading-relaxed text-zinc-400">
                Paste your extracted cookie string below. Clicking <strong>Save to cookie.txt & Test</strong> will
                automatically write to <code className="text-cyan-400">cookies/cookie.txt</code> and verify your live
                connection with Gemini.
              </p>

              <div className="space-y-3">
                <textarea
                  value={cookieTestInput}
                  onChange={(e) => setCookieTestInput(e.target.value)}
                  placeholder="Paste cookie string here (e.g. SID=...; SAPISID=...; __Secure-1PSID=...; __Secure-1PSIDTS=...;)"
                  rows={4}
                  className="w-full bg-[#0e0f13] border border-zinc-850 focus:border-cyan-500/50 rounded px-3 py-2 text-xs outline-none text-zinc-300 font-mono resize-y transition"
                />

                <div className="flex flex-wrap items-center gap-3 select-none">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!cookieTestInput.trim()) return;
                      await handleTestCookie();
                    }}
                    disabled={isTestingCookie || !cookieTestInput.trim()}
                    className="bg-cyan-500/20 border border-cyan-500/40 hover:bg-cyan-500/30 disabled:opacity-30 text-cyan-300 font-bold rounded px-4 py-2 text-xs font-mono transition flex items-center gap-2 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                  >
                    {isTestingCookie ? (
                      <>
                        <RefreshCw size={12} className="animate-spin" />
                        <span>Saving & Testing Gemini Connection...</span>
                      </>
                    ) : (
                      <>
                        <Check size={12} />
                        <span>Save to cookie.txt & Test Live</span>
                      </>
                    )}
                  </button>

                  {testResult && (
                    <div
                      className={`px-3 py-2 rounded border text-[10px] font-bold uppercase tracking-wide flex items-center gap-2 ${
                        testResult.success
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                          : "bg-rose-500/10 border-rose-500/30 text-rose-400"
                      }`}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${testResult.success ? "bg-emerald-400 animate-pulse" : "bg-rose-400"}`}
                      />
                      <span>{testResult.message}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Step 6: Diagnostics / Troubleshooting */}
          <section
            id="step-diagnostics"
            className="bg-[#0b0c0f] border border-zinc-800 rounded p-5 space-y-4 scroll-mt-6"
          >
            <div className="border-b border-zinc-900 pb-3 flex items-center gap-2 select-none">
              <Shield size={14} className="text-cyan-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                6. Error Handling & Diagnostics
              </h3>
            </div>

            <div className="space-y-4 text-[11px] text-zinc-350 font-mono">
              {[
                {
                  id: 1,
                  err: 'Error "Cookie expired or invalid"',
                  cause: "Your Google session credentials have expired or you logged out in your browser.",
                  solve: "Open gemini.google.com, make sure you are actively logged in, and copy fresh cookies."
                },
                {
                  id: 2,
                  err: 'Error "API key has expired"',
                  cause: "The API bearer key generated via Key Generator has reached its expiration timestamp.",
                  solve: "Issue a new API Key on the Key tab with a longer validity period."
                },
                {
                  id: 3,
                  err: 'Error "Rate limit exceeded / 429"',
                  cause: "The client or cookie has exceeded the maximum queries per minute rate limits.",
                  solve:
                    "Throttle request loops on the client side. If using custom bearer keys, create one with no limits."
                },
                {
                  id: 4,
                  err: "OpenCode client connection failure",
                  cause: "Incorrect baseURL matching or authorization header configuration.",
                  solve:
                    "Make sure baseURL ends with /v1. Check that the port matches the host configuration (default 8081)."
                },
                {
                  id: 5,
                  err: "Local gateway server fails to boot",
                  cause: "Another application is already listening on default port 8081.",
                  solve: "Change the PORT settings inside apps/gateway/.env to another unoccupied port."
                }
              ].map((trouble) => (
                <div key={trouble.id} className="space-y-1.5 border-b border-zinc-900 pb-3 last:border-0 last:pb-0">
                  <h4 className="font-bold text-zinc-200 text-xs flex items-center gap-1.5">
                    <span className="text-amber-500 font-mono select-none">#{trouble.id}</span> {trouble.err}
                  </h4>
                  <p className="text-zinc-400 pl-4 leading-relaxed">
                    <strong>Cause:</strong> {trouble.cause}
                  </p>
                  <p className="text-zinc-400 pl-4 leading-relaxed">
                    <strong>Resolution:</strong> {trouble.solve}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
