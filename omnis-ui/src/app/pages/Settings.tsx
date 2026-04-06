import { useState } from "react";
import { Copy, Trash2, Plus } from "lucide-react";

export default function Settings() {
  const [activeSection, setActiveSection] = useState("models");

  const sections = [
    { id: "general", label: "General" },
    { id: "api-keys", label: "API Keys" },
    { id: "models", label: "Models" },
    { id: "ingestion", label: "Ingestion" },
    { id: "billing", label: "Billing" },
  ];

  const apiKeys = [
    { id: 1, name: "Production Key", prefix: "sk_live_abc...", scopes: "read, write", lastUsed: "2026-04-05", expires: "2026-12-31" },
    { id: 2, name: "Development Key", prefix: "sk_test_xyz...", scopes: "read", lastUsed: "2026-04-03", expires: "2026-12-31" },
  ];

  const [haikuThreshold, setHaikuThreshold] = useState(30);
  const [sonnetThreshold, setSonnetThreshold] = useState(70);

  const estimatedCosts = {
    haiku: haikuThreshold * 0.15,
    sonnet: (sonnetThreshold - haikuThreshold) * 0.45,
    opus: (100 - sonnetThreshold) * 1.2,
  };

  const totalEstimated = estimatedCosts.haiku + estimatedCosts.sonnet + estimatedCosts.opus;

  return (
    <div className="h-full flex overflow-hidden" style={{ background: 'var(--background)' }}>
      {/* Sub Navigation */}
      <aside
        className="w-[220px] p-4"
        style={{ borderRight: '1px solid var(--border)' }}
      >
        <div className="space-y-1">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className="w-full text-left px-3 py-2 rounded-lg transition-all duration-150"
              style={{
                background: activeSection === section.id ? 'var(--elevated)' : 'transparent',
                color: activeSection === section.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
              }}
            >
              {section.label}
            </button>
          ))}
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-[900px]">
          {activeSection === "general" && (
            <div>
              <h2 className="mb-6" style={{ fontFamily: 'var(--font-display)', fontSize: '32px', color: 'var(--text-primary)' }}>
                General Settings
              </h2>
              <div className="space-y-6">
                <div
                  className="p-6 rounded-xl"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <label className="block mb-2" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                    Organization Name
                  </label>
                  <input
                    type="text"
                    defaultValue="KnowledgeHub Research"
                    className="w-full px-4 py-2 rounded-lg"
                    style={{
                      background: 'var(--elevated)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '13px'
                    }}
                  />
                </div>
                <div
                  className="p-6 rounded-xl"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <label className="block mb-2" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                    Default Model
                  </label>
                  <select
                    className="w-full px-4 py-2 rounded-lg"
                    style={{
                      background: 'var(--elevated)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '13px'
                    }}
                  >
                    <option>Sonnet (Balanced)</option>
                    <option>Haiku (Fast)</option>
                    <option>Opus (Powerful)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeSection === "api-keys" && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '32px', color: 'var(--text-primary)' }}>
                  API Keys
                </h2>
                <button
                  className="px-4 py-2 rounded-lg flex items-center gap-2"
                  style={{
                    background: 'var(--accent-teal)',
                    color: 'var(--background)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px'
                  }}
                >
                  <Plus size={14} />
                  Create new key
                </button>
              </div>
              <div
                className="rounded-xl overflow-hidden"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <table className="w-full">
                  <thead style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)' }}>
                    <tr>
                      <th className="text-left py-3 px-4 text-[11px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                        NAME
                      </th>
                      <th className="text-left py-3 px-4 text-[11px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                        PREFIX
                      </th>
                      <th className="text-left py-3 px-4 text-[11px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                        SCOPES
                      </th>
                      <th className="text-left py-3 px-4 text-[11px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                        LAST USED
                      </th>
                      <th className="text-left py-3 px-4 text-[11px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                        ACTIONS
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {apiKeys.map((key) => (
                      <tr key={key.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td className="py-3 px-4 text-[13px]" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                          {key.name}
                        </td>
                        <td className="py-3 px-4 text-[13px]" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                          {key.prefix}
                        </td>
                        <td className="py-3 px-4 text-[13px]" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                          {key.scopes}
                        </td>
                        <td className="py-3 px-4 text-[13px]" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                          {key.lastUsed}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <button className="p-1.5 rounded transition-colors" style={{ color: 'var(--text-secondary)' }}>
                              <Copy size={14} />
                            </button>
                            <button className="p-1.5 rounded transition-colors" style={{ color: 'var(--danger)' }}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeSection === "models" && (
            <div>
              <h2 className="mb-6" style={{ fontFamily: 'var(--font-display)', fontSize: '32px', color: 'var(--text-primary)' }}>
                Model Configuration
              </h2>

              {/* Router Diagram */}
              <div
                className="p-8 rounded-xl mb-6"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div className="text-[11px] mb-6" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  INTELLIGENT MODEL ROUTER
                </div>
                <div className="flex items-center justify-between">
                  {/* Classifier */}
                  <div
                    className="p-4 rounded-lg"
                    style={{ background: 'var(--elevated)', border: '1px solid var(--border)', minWidth: '180px' }}
                  >
                    <div className="text-[12px] mb-1" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                      Query Classifier
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                      Analyzes complexity
                    </div>
                  </div>

                  {/* Arrows */}
                  <div className="flex flex-col gap-6 px-6">
                    <div className="flex items-center gap-2">
                      <div className="h-px w-12" style={{ background: 'var(--border)' }} />
                      <div className="text-[10px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                        0-{haikuThreshold}%
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-px w-12" style={{ background: 'var(--border)' }} />
                      <div className="text-[10px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                        {haikuThreshold}-{sonnetThreshold}%
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-px w-12" style={{ background: 'var(--border)' }} />
                      <div className="text-[10px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                        {sonnetThreshold}-100%
                      </div>
                    </div>
                  </div>

                  {/* Models */}
                  <div className="flex flex-col gap-4 flex-1">
                    <div
                      className="p-4 rounded-lg"
                      style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[12px]" style={{ color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>
                          ⚡ Haiku
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                          $0.25/MTok
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px]" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                          {haikuThreshold}% of queries
                        </span>
                        <span className="text-[10px]" style={{ color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)' }}>
                          ~${estimatedCosts.haiku.toFixed(2)}/mo
                        </span>
                      </div>
                    </div>
                    <div
                      className="p-4 rounded-lg"
                      style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[12px]" style={{ color: 'var(--accent-indigo)', fontFamily: 'var(--font-mono)' }}>
                          ◆ Sonnet
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                          $3.00/MTok
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px]" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                          {sonnetThreshold - haikuThreshold}% of queries
                        </span>
                        <span className="text-[10px]" style={{ color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)' }}>
                          ~${estimatedCosts.sonnet.toFixed(2)}/mo
                        </span>
                      </div>
                    </div>
                    <div
                      className="p-4 rounded-lg"
                      style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[12px]" style={{ color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)' }}>
                          ✦ Opus
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                          $15.00/MTok
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px]" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                          {100 - sonnetThreshold}% of queries
                        </span>
                        <span className="text-[10px]" style={{ color: 'var(--accent-amber)', fontFamily: 'var(--font-mono)' }}>
                          ~${estimatedCosts.opus.toFixed(2)}/mo
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Total Estimate */}
                <div className="mt-6 pt-6" style={{ borderTop: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                      ESTIMATED MONTHLY COST
                    </span>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '24px', color: 'var(--accent-amber)' }}>
                      ${totalEstimated.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Threshold Sliders */}
              <div className="space-y-6">
                <div
                  className="p-6 rounded-xl"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <label className="text-[13px]" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                      Haiku Threshold (Simple queries)
                    </label>
                    <span className="text-[13px]" style={{ color: 'var(--accent-teal)', fontFamily: 'var(--font-mono)' }}>
                      {haikuThreshold}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={haikuThreshold}
                    onChange={(e) => setHaikuThreshold(parseInt(e.target.value))}
                    className="w-full"
                    style={{ accentColor: 'var(--accent-teal)' }}
                  />
                </div>

                <div
                  className="p-6 rounded-xl"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <label className="text-[13px]" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                      Sonnet Threshold (Medium queries)
                    </label>
                    <span className="text-[13px]" style={{ color: 'var(--accent-indigo)', fontFamily: 'var(--font-mono)' }}>
                      {sonnetThreshold}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={sonnetThreshold}
                    onChange={(e) => setSonnetThreshold(parseInt(e.target.value))}
                    className="w-full"
                    style={{ accentColor: 'var(--accent-indigo)' }}
                  />
                </div>
              </div>
            </div>
          )}

          {activeSection === "ingestion" && (
            <div>
              <h2 className="mb-6" style={{ fontFamily: 'var(--font-display)', fontSize: '32px', color: 'var(--text-primary)' }}>
                Ingestion Settings
              </h2>
              <div className="space-y-6">
                <div
                  className="p-6 rounded-xl"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <label className="block mb-2" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                    Chunk Size (tokens)
                  </label>
                  <input
                    type="number"
                    defaultValue="512"
                    className="w-full px-4 py-2 rounded-lg"
                    style={{
                      background: 'var(--elevated)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '13px'
                    }}
                  />
                </div>
                <div
                  className="p-6 rounded-xl"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <label className="block mb-2" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
                    Chunk Overlap (tokens)
                  </label>
                  <input
                    type="number"
                    defaultValue="128"
                    className="w-full px-4 py-2 rounded-lg"
                    style={{
                      background: 'var(--elevated)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '13px'
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {activeSection === "billing" && (
            <div>
              <h2 className="mb-6" style={{ fontFamily: 'var(--font-display)', fontSize: '32px', color: 'var(--text-primary)' }}>
                Billing
              </h2>

              {/* Usage Gauge */}
              <div
                className="p-8 rounded-xl mb-6 flex items-center justify-between"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div>
                  <div className="text-[11px] mb-2" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    TOKENS USED THIS MONTH
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '48px', color: 'var(--text-primary)' }}>
                    68M
                  </div>
                  <div className="text-[13px]" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    of 100M • 32M remaining
                  </div>
                </div>
                <div className="relative w-32 h-32">
                  <svg className="transform -rotate-90 w-32 h-32">
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke="var(--border)"
                      strokeWidth="8"
                      fill="none"
                    />
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke="var(--accent-teal)"
                      strokeWidth="8"
                      fill="none"
                      strokeDasharray={`${2 * Math.PI * 56}`}
                      strokeDashoffset={`${2 * Math.PI * 56 * (1 - 0.68)}`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center" style={{ fontFamily: 'var(--font-display)', fontSize: '20px', color: 'var(--text-primary)' }}>
                    68%
                  </div>
                </div>
              </div>

              {/* Plan */}
              <div
                className="p-6 rounded-xl"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] mb-1" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                      CURRENT PLAN
                    </div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '24px', color: 'var(--text-primary)' }}>
                      Professional
                    </div>
                    <div className="text-[13px] mt-1" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                      $49/month • 100M tokens
                    </div>
                  </div>
                  <button
                    className="px-4 py-2 rounded-lg"
                    style={{
                      background: 'var(--accent-teal)',
                      color: 'var(--background)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '13px'
                    }}
                  >
                    Upgrade Plan
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
