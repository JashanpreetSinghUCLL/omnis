import { LineChart, Line, BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Play, ChevronDown } from "lucide-react";

const metricsData = [
  { name: "Run 1", faithfulness: 0.88, relevancy: 0.85, precision: 0.82 },
  { name: "Run 2", faithfulness: 0.89, relevancy: 0.86, precision: 0.83 },
  { name: "Run 3", faithfulness: 0.91, relevancy: 0.88, precision: 0.84 },
  { name: "Run 4", faithfulness: 0.90, relevancy: 0.87, precision: 0.83 },
  { name: "Run 5", faithfulness: 0.91, relevancy: 0.87, precision: 0.83 },
];

const radarData = [
  { metric: "Faithfulness", baseline: 0.88, current: 0.91 },
  { metric: "Relevancy", baseline: 0.86, current: 0.87 },
  { metric: "Precision", baseline: 0.80, current: 0.83 },
  { metric: "Recall", baseline: 0.79, current: 0.85 },
  { metric: "Correctness", baseline: 0.82, current: 0.88 },
];

const costData = [
  { model: "Query 1", haiku: 0.0012, sonnet: 0.0045, opus: 0 },
  { model: "Query 2", haiku: 0.0010, sonnet: 0.0038, opus: 0.012 },
  { model: "Query 3", haiku: 0.0015, sonnet: 0, opus: 0 },
  { model: "Query 4", haiku: 0.0008, sonnet: 0.0042, opus: 0 },
];

const testCases = [
  { id: 1, question: "What is backpropagation?", expected: "A supervised learning algorithm...", got: "A supervised learning algorithm...", faithfulness: 0.95, relevancy: 0.92, pass: true },
  { id: 2, question: "Explain neural network layers", expected: "Neural networks consist of input, hidden...", got: "Neural networks consist of input, hidden...", faithfulness: 0.89, relevancy: 0.87, pass: true },
  { id: 3, question: "How does gradient descent work?", expected: "An optimization algorithm...", got: "Gradient descent is a method...", faithfulness: 0.72, relevancy: 0.68, pass: false },
  { id: 4, question: "What are activation functions?", expected: "Functions that introduce non-linearity...", got: "Functions that introduce non-linearity...", faithfulness: 0.94, relevancy: 0.91, pass: true },
];

export default function Evaluations() {
  return (
    <div className="h-full overflow-y-auto" style={{ background: 'var(--background)' }}>
      <div className="max-w-[1400px] mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '32px', color: 'var(--text-primary)' }}>
            Evaluations Dashboard
          </h1>
          <button
            className="px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
            style={{
              background: 'var(--accent-teal)',
              color: 'var(--background)',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px'
            }}
          >
            <Play size={14} fill="currentColor" />
            Run eval
          </button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-4">
          <div
            className="p-6 rounded-xl"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="text-[11px] mb-2" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              FAITHFULNESS
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '32px', color: 'var(--text-primary)' }}>
                0.91
              </span>
              <span className="text-[13px]" style={{ color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>
                ↑ +0.03
              </span>
            </div>
            <div className="h-8 flex items-end gap-0.5">
              {[0.88, 0.89, 0.91, 0.90, 0.91, 0.90, 0.91, 0.92, 0.91, 0.91].map((val, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t"
                  style={{ background: 'var(--accent-teal)', height: `${val * 100}%`, opacity: 0.3 + i * 0.07 }}
                />
              ))}
            </div>
          </div>

          <div
            className="p-6 rounded-xl"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="text-[11px] mb-2" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              RELEVANCY
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '32px', color: 'var(--text-primary)' }}>
                0.87
              </span>
              <span className="text-[13px]" style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>
                ↓ -0.01
              </span>
            </div>
            <div className="h-8 flex items-end gap-0.5">
              {[0.85, 0.86, 0.88, 0.87, 0.87, 0.88, 0.87, 0.86, 0.87, 0.87].map((val, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t"
                  style={{ background: 'var(--accent-indigo)', height: `${val * 100}%`, opacity: 0.3 + i * 0.07 }}
                />
              ))}
            </div>
          </div>

          <div
            className="p-6 rounded-xl"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="text-[11px] mb-2" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              PRECISION
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '32px', color: 'var(--text-primary)' }}>
                0.83
              </span>
              <span className="text-[13px]" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                → stable
              </span>
            </div>
            <div className="h-8 flex items-end gap-0.5">
              {[0.82, 0.83, 0.84, 0.83, 0.83, 0.82, 0.83, 0.84, 0.83, 0.83].map((val, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t"
                  style={{ background: 'var(--accent-amber)', height: `${val * 100}%`, opacity: 0.3 + i * 0.07 }}
                />
              ))}
            </div>
          </div>

          <div
            className="p-6 rounded-xl"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="text-[11px] mb-2" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              PASS RATE
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '32px', color: 'var(--text-primary)' }}>
                94.2%
              </span>
              <span className="text-[13px]" style={{ color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>
                ↑ +2.1%
              </span>
            </div>
            <div className="h-8 flex items-end gap-0.5">
              {[0.92, 0.93, 0.94, 0.94, 0.942, 0.94, 0.945, 0.94, 0.942, 0.942].map((val, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t"
                  style={{ background: 'var(--success)', height: `${val * 100}%`, opacity: 0.3 + i * 0.07 }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-3 gap-4">
          {/* Line Chart */}
          <div
            className="p-6 rounded-xl"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="text-[11px] mb-4" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              METRICS OVER TIME
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={metricsData}>
                <CartesianGrid key="grid" strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis key="x" dataKey="name" stroke="var(--text-tertiary)" style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }} />
                <YAxis key="y" stroke="var(--text-tertiary)" style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }} domain={[0.7, 1]} />
                <Tooltip
                  key="tooltip"
                  contentStyle={{ background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: '8px', fontFamily: 'var(--font-mono)', fontSize: '11px' }}
                />
                <Line key="line-faithfulness" type="monotone" dataKey="faithfulness" stroke="#00D9C0" strokeWidth={2} dot={{ fill: '#00D9C0' }} />
                <Line key="line-relevancy" type="monotone" dataKey="relevancy" stroke="#6B7FFF" strokeWidth={2} dot={{ fill: '#6B7FFF' }} />
                <Line key="line-precision" type="monotone" dataKey="precision" stroke="#FFB547" strokeWidth={2} dot={{ fill: '#FFB547' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Radar Chart */}
          <div
            className="p-6 rounded-xl"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="text-[11px] mb-4" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              CURRENT VS BASELINE
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={radarData}>
                <PolarGrid key="polar-grid" stroke="var(--border)" />
                <PolarAngleAxis key="polar-angle" dataKey="metric" stroke="var(--text-secondary)" style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }} />
                <PolarRadiusAxis key="polar-radius" stroke="var(--text-tertiary)" domain={[0, 1]} style={{ fontSize: '9px', fontFamily: 'var(--font-mono)' }} />
                <Radar key="radar-baseline" name="Baseline" dataKey="baseline" stroke="#7A8FA6" fill="#7A8FA6" fillOpacity={0.1} strokeDasharray="3 3" />
                <Radar key="radar-current" name="Current" dataKey="current" stroke="#00D9C0" fill="#00D9C0" fillOpacity={0.15} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Bar Chart */}
          <div
            className="p-6 rounded-xl"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="text-[11px] mb-4" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
              COST BY MODEL
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={costData}>
                <CartesianGrid key="grid" strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis key="x" dataKey="model" stroke="var(--text-tertiary)" style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }} />
                <YAxis key="y" stroke="var(--text-tertiary)" style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }} />
                <Tooltip
                  key="tooltip"
                  contentStyle={{ background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: '8px', fontFamily: 'var(--font-mono)', fontSize: '11px' }}
                />
                <Bar key="bar-haiku" dataKey="haiku" fill="#00D9C0" />
                <Bar key="bar-sonnet" dataKey="sonnet" fill="#6B7FFF" />
                <Bar key="bar-opus" dataKey="opus" fill="#FFB547" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Test Cases Table */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="p-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--text-primary)' }}>
              Test Cases
            </h3>
            <div className="flex items-center gap-2">
              <button
                className="px-3 py-1.5 rounded flex items-center gap-1 text-[11px]"
                style={{
                  border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)'
                }}
              >
                All <ChevronDown size={12} />
              </button>
              <button
                className="px-3 py-1.5 rounded text-[11px]"
                style={{
                  border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)'
                }}
              >
                Export CSV
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ background: 'var(--elevated)', borderBottom: '1px solid var(--border)' }}>
                <tr>
                  <th className="text-left py-3 px-4 text-[11px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                    QUESTION
                  </th>
                  <th className="text-left py-3 px-4 text-[11px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                    FAITHFULNESS
                  </th>
                  <th className="text-left py-3 px-4 text-[11px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                    RELEVANCY
                  </th>
                  <th className="text-left py-3 px-4 text-[11px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                    STATUS
                  </th>
                </tr>
              </thead>
              <tbody>
                {testCases.map((testCase) => (
                  <tr
                    key={testCase.id}
                    className="transition-colors hover:bg-[var(--elevated)]"
                    style={{
                      borderBottom: '1px solid var(--border)',
                      borderLeft: testCase.pass ? 'none' : '3px solid var(--danger)',
                      background: testCase.pass ? 'transparent' : 'rgba(255, 77, 106, 0.05)'
                    }}
                  >
                    <td className="py-3 px-4 text-[13px]" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                      {testCase.question}
                    </td>
                    <td className="py-3 px-4 text-[13px]" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {testCase.faithfulness.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-[13px]" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {testCase.relevancy.toFixed(2)}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className="px-2 py-1 rounded text-[11px]"
                        style={{
                          background: testCase.pass ? 'rgba(0, 196, 140, 0.12)' : 'rgba(255, 77, 106, 0.12)',
                          color: testCase.pass ? 'var(--success)' : 'var(--danger)',
                          border: testCase.pass ? '1px solid rgba(0, 196, 140, 0.25)' : '1px solid rgba(255, 77, 106, 0.25)',
                          fontFamily: 'var(--font-mono)'
                        }}
                      >
                        {testCase.pass ? "PASS" : "FAIL"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}